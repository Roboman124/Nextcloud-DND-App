<?php
declare(strict_types=1);

namespace OCA\Grimoire\Controller;

use OCA\Grimoire\AppInfo\Application;
use OCA\Grimoire\Db\SceneMapper;
use OCA\Grimoire\Service\DiscordService;
use OCA\Grimoire\Db\CampaignMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\OCSController;
use OCP\ICacheFactory;
use OCP\IRequest;

/**
 * Real-time room relay over Nextcloud's distributed cache.
 *
 * Multiplayer needs low-latency fan-out of small messages (token moved, pointer
 * position, dice rolled). A dedicated WebSocket service (server/relay.js) is the
 * lowest-latency option, but it means running another process. To make
 * multiplayer work out of the box with nothing extra deployed, this controller
 * implements the long-poll fallback the SyncClient already knows how to use:
 *
 *   - token() : authorise the caller for a scene's room and hand back a token.
 *               relayUrl is returned empty so the client uses polling.
 *   - push()  : append a message to the room's ring buffer in the cache.
 *   - poll()  : return messages newer than the caller's cursor.
 *
 * Messages live in a distributed cache (Redis/APCu) with a short TTL — this is
 * transient presence/movement data, not durable state. Durable scene state is
 * saved separately via SceneController. If you later run the WS relay, point
 * GRIMOIRE_RELAY_URL at it and token() will return it instead.
 *
 * Discord side-effects: when a dice roll or player join flows through push(),
 * and the campaign has those Discord events enabled, we forward them to the
 * webhook. This is the "wire it up so it fires once sync lands" piece.
 */
class RoomController extends OCSController {
    private const TTL = 120;            // seconds a message survives in cache
    private const MAX_MESSAGES = 200;   // ring buffer cap per room

    public function __construct(
        IRequest $request,
        private SceneMapper $sceneMapper,
        private CampaignMapper $campaignMapper,
        private DiscordService $discord,
        private ICacheFactory $cacheFactory,
        private ?string $userId,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /**
     * POST /api/scenes/{id}/room-token
     * Verifies the caller can access the scene, returns a room token. relayUrl
     * is empty unless a WS relay is configured, so the client polls by default.
     */
    #[NoAdminRequired]
    public function token(int $id): JSONResponse {
        $scene = $this->accessibleSceneOr404($id);
        if ($scene instanceof JSONResponse) {
            return $scene;
        }
        $roomId = 'scene-' . $id;
        // The token isn't a security boundary in poll mode (every call is
        // already authenticated by Nextcloud's session + access check); it just
        // identifies the room and user to the relay if one is used.
        $token = $roomId . '.' . ($this->userId ?? 'anon');

        $relayUrl = getenv('GRIMOIRE_RELAY_URL') ?: '';

        // Probe the distributed cache: poll-mode multiplayer relies on it, and a
        // local-only (non-distributed) cache silently drops cross-request data.
        $cacheOk = $this->cacheFactory->isAvailable();

        return new JSONResponse([
            'token' => $token,
            'roomId' => $roomId,
            'relayUrl' => $relayUrl, // empty -> SyncClient uses long-poll
            'syncBackend' => $cacheOk ? 'cache' : 'none',
        ]);
    }

    /**
     * POST /api/room/push
     * Body: sceneId, type, payload. Appends a message to the room buffer.
     */
    #[NoAdminRequired]
    public function push(int $sceneId, string $type, $payload = null): JSONResponse {
        $scene = $this->accessibleSceneOr404($sceneId);
        if ($scene instanceof JSONResponse) {
            return $scene;
        }

        $cache = $this->cacheFactory->createDistributed(Application::APP_ID . '-room-');
        // Atomic sequence number: inc() is atomic in the distributed cache, so
        // concurrent pushes each get a unique seq with no read-modify-write race
        // (the previous shared-array approach silently dropped simultaneous
        // moves, e.g. during fast token dragging by multiple players).
        $seqKey = 'scene-' . $sceneId . '-seq';
        $seq = $cache->inc($seqKey);
        if (!$seq) {
            // First write or cache reset: establish the counter.
            $cache->set($seqKey, 1, self::TTL);
            $seq = 1;
        }
        // Keep the TTL fresh while the room is active.
        $cache->set($seqKey, $seq, self::TTL);

        $message = [
            'seq' => $seq,
            'type' => $type,
            'payload' => $payload,
            'from' => $this->userId,
            't' => round(microtime(true) * 1000),
        ];
        // Store each message under its own key so writers never overwrite each
        // other. Keys expire on their own TTL; poll reads the live range.
        $cache->set('scene-' . $sceneId . '-msg-' . $seq, $message, self::TTL);

        $this->maybeNotifyDiscord($scene->getCampaignId(), $type, $payload);

        return new JSONResponse(['seq' => $seq]);
    }

    /**
     * GET /api/room/poll?sceneId=..&since=..
     * Returns messages newer than `since`, plus the latest cursor.
     */
    #[NoAdminRequired]
    public function poll(int $sceneId = 0, int $since = 0): JSONResponse {
        if ($sceneId === 0) {
            return new JSONResponse(['messages' => [], 'cursor' => $since]);
        }
        $scene = $this->accessibleSceneOr404($sceneId);
        if ($scene instanceof JSONResponse) {
            return $scene;
        }

        $cache = $this->cacheFactory->createDistributed(Application::APP_ID . '-room-');
        $current = (int) ($cache->get('scene-' . $sceneId . '-seq') ?? 0);

        // Cache reset/expiry: if the latest seq is below the client's cursor, the
        // buffer was cleared — tell the client to jump to current (no replay).
        if ($current < $since) {
            return new JSONResponse(['messages' => [], 'cursor' => $current, 'reset' => true]);
        }

        $messages = [];
        // Only look back a bounded window so a long-lived room doesn't scan
        // thousands of keys; older messages have expired anyway.
        $from = max($since + 1, $current - self::MAX_MESSAGES + 1);
        for ($i = $from; $i <= $current; $i++) {
            $m = $cache->get('scene-' . $sceneId . '-msg-' . $i);
            if ($m) {
                $messages[] = $m;
            }
        }

        return new JSONResponse(['messages' => $messages, 'cursor' => $current]);
    }

    /** Forward dice/join events to the campaign's Discord webhook if enabled. */
    private function maybeNotifyDiscord(int $campaignId, string $type, $payload): void {
        $event = match (true) {
            str_starts_with($type, 'dice') => 'dice',
            $type === 'join' || $type === 'presence:join' => 'join',
            default => null,
        };
        if ($event === null) {
            return;
        }
        try {
            $campaign = $this->campaignMapper->find($campaignId);
        } catch (DoesNotExistException) {
            return;
        }
        $data = json_decode($campaign->getData() ?? '{}', true) ?: [];
        if (!$this->discord->isEventEnabled($data, $event)) {
            return;
        }

        if ($event === 'dice') {
            $total = is_array($payload) ? ($payload['total'] ?? '?') : '?';
            $notation = is_array($payload) ? ($payload['notation'] ?? '') : '';
            $text = "🎲 **Dice roll** in {$campaign->getTitle()}: {$notation} → **{$total}**";
        } else {
            $who = is_array($payload) ? ($payload['userId'] ?? 'A player') : 'A player';
            $text = "👋 **{$who}** joined the table in {$campaign->getTitle()}.";
        }
        $this->discord->post($data, $text);
    }

    private function accessibleSceneOr404(int $id): \OCA\Grimoire\Db\Scene|JSONResponse {
        try {
            $scene = $this->sceneMapper->find($id);
        } catch (DoesNotExistException) {
            return new JSONResponse(['error' => 'Scene not found'], Http::STATUS_NOT_FOUND);
        }
        // Access check: the caller must own the campaign OR be an invited player.
        try {
            $campaign = $this->campaignMapper->find($scene->getCampaignId());
        } catch (DoesNotExistException) {
            return new JSONResponse(['error' => 'Campaign not found'], Http::STATUS_NOT_FOUND);
        }
        if (!$this->canAccess($campaign)) {
            return new JSONResponse(['error' => 'Forbidden'], Http::STATUS_FORBIDDEN);
        }
        return $scene;
    }

    private function canAccess(\OCA\Grimoire\Db\Campaign $campaign): bool {
        if ($campaign->getOwner() === $this->userId) {
            return true;
        }
        $data = json_decode($campaign->getData() ?? '{}', true) ?: [];
        $players = $data['players'] ?? [];
        return in_array($this->userId, $players, true);
    }
}
