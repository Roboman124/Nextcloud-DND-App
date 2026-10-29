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
 * Real-time room sync over Nextcloud's distributed cache — the app's single
 * multiplayer transport.
 *
 * Multiplayer needs fan-out of small messages (token moved, pointer position,
 * dice rolled). This controller implements it entirely inside Nextcloud, with
 * nothing extra to deploy:
 *
 *   - handshake() : authorise the caller for a scene's room and return their
 *                   role, the campaign's permissions and cache availability.
 *   - push()      : validate the message against the caller's permissions, then
 *                   append it to the room's message buffer in the cache.
 *   - poll()      : return messages newer than the caller's cursor.
 *
 * Messages live in a distributed cache (Redis/APCu — bundled with AIO) with a
 * short TTL: transient movement/presence data, not durable state. Durable scene
 * state is saved separately via SceneController.
 *
 * Discord side-effects: when a dice roll or player join flows through push(),
 * and the campaign has those Discord events enabled, we forward them to the
 * webhook.
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
     * Room handshake: verifies the caller can access the scene and returns the
     * caller's role, the campaign's per-layer permissions, and whether a
     * distributed cache is available (multiplayer needs one). Polling needs no
     * token — every push/poll request is authenticated by Nextcloud itself.
     */
    #[NoAdminRequired]
    public function handshake(int $id): JSONResponse {
        $scene = $this->accessibleSceneOr404($id);
        if ($scene instanceof JSONResponse) {
            return $scene;
        }

        // Probe the distributed cache: multiplayer relies on it, and a
        // local-only (non-distributed) cache silently drops cross-request data.
        $cacheOk = $this->cacheFactory->isAvailable();

        return new JSONResponse([
            'syncBackend' => $cacheOk ? 'cache' : 'none',
            'role' => $this->roleFor($scene->getCampaignId()),
            'permissions' => $this->permissionsFor($scene->getCampaignId()),
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

        // Fog of war is GM-only: a player must not be able to reveal/hide
        // terrain. Block any fog:* message from a non-GM.
        if (str_starts_with($type, 'fog:') && !$this->isGm($scene->getCampaignId())) {
            return new JSONResponse(['error' => 'Fog is GM-only'], Http::STATUS_FORBIDDEN);
        }
        // HP edits are GM-only: players see bars but can't change them.
        if ($type === 'token:hp' && !$this->isGm($scene->getCampaignId())) {
            return new JSONResponse(['error' => 'HP is GM-only'], Http::STATUS_FORBIDDEN);
        }

        // Per-layer player permissions: a non-GM is blocked from create/update/
        // delete on each layer unless the campaign allows it. GMs bypass.
        if (!$this->isGm($scene->getCampaignId())) {
            $layerAction = $this->layerActionFor($type);
            // An upsert of an EXISTING token is an update (rotate/scale/rename),
            // not a create — so it's the update permission that gates it.
            if ($layerAction !== null && $type === 'token:upsert' && is_array($payload)
                && isset($payload['id']) && is_string($payload['id'])
                && $this->tokenExists($sceneId, $payload['id'])) {
                $layerAction[1] = 'update';
            }
            if ($layerAction !== null) {
                [$layer, $action] = $layerAction;
                $perms = $this->permissionsFor($scene->getCampaignId());
                $allowed = $perms[$layer][$action] ?? true;
                // ownerOnly on tokens: a player may only update/delete their
                // own. Ownership resolves from the PERSISTED scene doc and is
                // never taken from the client; unresolvable (unowned/legacy)
                // tokens are DENIED — deny by default, not allow.
                if ($allowed && ($perms[$layer]['ownerOnly'] ?? false) && $action !== 'create') {
                    $tokenOwner = $this->tokenOwner($sceneId, $payload);
                    $allowed = $tokenOwner !== null && $tokenOwner === $this->userId;
                }
                if (!$allowed) {
                    return new JSONResponse(['error' => "Permission denied: {$layer}.{$action}"], Http::STATUS_FORBIDDEN);
                }
            }
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

    /** 'gm' for the campaign owner, 'player' for an invited member, '' otherwise. */
    private function roleFor(int $campaignId): string {
        try {
            $campaign = $this->campaignMapper->find($campaignId);
        } catch (DoesNotExistException) {
            return '';
        }
        if ($campaign->getOwner() === $this->userId) return 'gm';
        $data = json_decode($campaign->getData() ?? '{}', true) ?: [];
        if (in_array($this->userId, $data['players'] ?? [], true)) return 'player';
        return '';
    }

    private function isGm(int $campaignId): bool {
        return $this->roleFor($campaignId) === 'gm';
    }

    /** The campaign's per-layer player permission flags (GM sees all). */
    private function permissionsFor(int $campaignId): array {
        try {
            $campaign = $this->campaignMapper->find($campaignId);
        } catch (DoesNotExistException) {
            return [];
        }
        $data = json_decode($campaign->getData() ?? '{}', true) ?: [];
        $perms = $data['permissions'] ?? [];
        // Default: everything allowed (backward compat).
        $layers = ['maps', 'tokens', 'drawings', 'fog'];
        $out = [];
        foreach ($layers as $layer) {
            $out[$layer] = array_merge(
                ['create' => true, 'update' => true, 'delete' => true, 'ownerOnly' => false],
                $perms[$layer] ?? []
            );
        }
        return $out;
    }

    /** Map a sync message type to [layer, action] for permission checks. */
    private function layerActionFor(string $type): ?array {
        return match (true) {
            str_starts_with($type, 'token:upsert') => ['tokens', 'create'],
            str_starts_with($type, 'token:move') => ['tokens', 'update'],
            str_starts_with($type, 'token:remove') => ['tokens', 'delete'],
            str_starts_with($type, 'map:set') => ['maps', 'create'],
            str_starts_with($type, 'draw:') => ['drawings', 'create'],
            str_starts_with($type, 'fog:') => ['fog', 'create'],
            str_starts_with($type, 'aoe:') => ['drawings', 'create'],
            str_starts_with($type, 'block:') => ['maps', 'create'],
            str_starts_with($type, 'measure:') => ['drawings', 'create'],
            default => null,
        };
    }

    /** The persisted token list of a scene (empty on any failure). */
    private function sceneTokens(int $sceneId): array {
        try {
            $scene = $this->sceneMapper->find($sceneId);
        } catch (\Throwable) {
            return [];
        }
        $data = json_decode($scene->getData() ?? '{}', true) ?: [];
        return is_array($data['tokens'] ?? null) ? $data['tokens'] : [];
    }

    private function tokenExists(int $sceneId, string $id): bool {
        foreach ($this->sceneTokens($sceneId) as $t) {
            if (is_array($t) && ($t['id'] ?? null) === $id) return true;
        }
        return false;
    }

    /** Resolve a token's owner from the PERSISTED scene document. Never
     * trusts client data: an unresolvable (or unowned/legacy) token is null,
     * and the ownerOnly gate DENIES null — deny by default. */
    private function tokenOwner(int $sceneId, $payload): ?string {
        if (!is_array($payload)) return null;
        $id = $payload['id'] ?? null;
        if (!$id || !is_string($id)) return null;
        foreach ($this->sceneTokens($sceneId) as $t) {
            if (is_array($t) && ($t['id'] ?? null) === $id) {
                $owner = $t['owner'] ?? null;
                return is_string($owner) && $owner !== '' ? $owner : null;
            }
        }
        return null;
    }
}
