<?php
declare(strict_types=1);

namespace OCA\Grimoire\Controller;

use OCA\Grimoire\AppInfo\Application;
use OCA\Grimoire\Db\Campaign;
use OCA\Grimoire\Db\CampaignMapper;
use OCA\Grimoire\Service\DiscordService;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/**
 * CRUD for campaigns, scoped to the logged-in user. Ownership is checked on
 * every read/write so users can only touch their own games. (Player sharing is
 * a later milestone — see ARCHITECTURE.md.)
 */
class CampaignController extends OCSController {
    public function __construct(
        IRequest $request,
        private CampaignMapper $mapper,
        private DiscordService $discord,
        private ?string $userId,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    #[NoAdminRequired]
    public function index(): JSONResponse {
        $owned = $this->mapper->findAllForUser($this->userId);
        $shared = $this->mapper->findSharedWithUser($this->userId);
        $out = [];
        foreach ($owned as $c) {
            $arr = $this->sanitize($c);
            $arr['role'] = 'owner';
            $out[] = $arr;
        }
        foreach ($shared as $c) {
            $arr = $this->sanitize($c);
            $arr['role'] = 'player';
            $out[] = $arr;
        }
        return new JSONResponse($out);
    }

    #[NoAdminRequired]
    public function create(string $title, string $description = ''): JSONResponse {
        $c = new Campaign();
        $c->setTitle($title);
        $c->setDescription($description);
        $c->setOwner($this->userId);
        $c->setCreatedAt((new \DateTime())->format('c'));
        return new JSONResponse($this->sanitize($this->mapper->insert($c)));
    }

    #[NoAdminRequired]
    public function show(int $id): JSONResponse {
        $c = $this->ownedOr404($id);
        return $c instanceof JSONResponse ? $c : new JSONResponse($this->sanitize($c));
    }

    #[NoAdminRequired]
    public function update(int $id, string $title, string $description = '', ?string $data = null): JSONResponse {
        $c = $this->ownedOr404($id);
        if ($c instanceof JSONResponse) return $c;
        $c->setTitle($title);
        $c->setDescription($description);
        if ($data !== null) {
            // Preserve any server-only Discord webhook URL: the browser never
            // receives it (see sanitize()), so an incoming update would
            // otherwise wipe it. Merge the existing secret back in.
            $c->setData($this->mergePreservingSecrets($c, $data));
        }
        return new JSONResponse($this->sanitize($this->mapper->update($c)));
    }

    /**
     * PUT /api/campaigns/{id}/discord
     * Body: webhookUrl (optional — empty clears), events (object of bool flags).
     * The webhook URL is stored but never returned to the browser.
     */
    #[NoAdminRequired]
    public function discord(int $id, string $webhookUrl = '', array $events = []): JSONResponse {
        $c = $this->ownedOr404($id);
        if ($c instanceof JSONResponse) return $c;

        $data = json_decode($c->getData() ?? '{}', true) ?: [];
        $existing = $data['discord'] ?? [];

        // Webhook URL handling:
        //  - "__CLEAR__"  -> remove the stored URL
        //  - ""           -> leave the existing URL untouched (just update events)
        //  - anything else -> set as the new URL
        $newUrl = $existing['webhookUrl'] ?? '';
        if ($webhookUrl === '__CLEAR__') {
            $newUrl = '';
        } elseif ($webhookUrl !== '') {
            $candidate = trim($webhookUrl);
            if (!$this->discord->isValidWebhook($candidate)) {
                return new JSONResponse(
                    ['error' => 'That does not look like a Discord webhook URL (must be https://discord.com/api/webhooks/...).'],
                    Http::STATUS_BAD_REQUEST
                );
            }
            $newUrl = $candidate;
        }

        $data['discord'] = [
            'webhookUrl' => $newUrl,
            'events' => array_map(static fn($v) => (bool) $v, $events),
        ];
        $c->setData(json_encode($data));
        $this->mapper->update($c);

        return new JSONResponse($this->discordPublicView($data));
    }

    #[NoAdminRequired]
    public function destroy(int $id): JSONResponse {
        $c = $this->ownedOr404($id);
        if ($c instanceof JSONResponse) return $c;
        $this->mapper->delete($c);
        return new JSONResponse([], Http::STATUS_NO_CONTENT);
    }

    /**
     * Return a campaign as the browser should see it: the Discord webhook URL is
     * removed from `data` and replaced with a boolean `hasWebhook` flag, so the
     * secret never crosses to the client.
     */
    private function sanitize(Campaign $c): array {
        $arr = $c->jsonSerialize();
        $data = json_decode($arr['data'] ?? '{}', true) ?: [];
        if (isset($data['discord'])) {
            $data['discord'] = $this->discordPublicView($data);
        }
        $arr['data'] = json_encode($data);
        return $arr;
    }

    /** The client-safe view of Discord config: flags only, no URL. */
    private function discordPublicView(array $data): array {
        $discord = $data['discord'] ?? [];
        return [
            'hasWebhook' => !empty($discord['webhookUrl']),
            'events' => $discord['events'] ?? [],
        ];
    }

    /** Merge an incoming data blob from the browser, keeping the secret URL. */
    private function mergePreservingSecrets(Campaign $c, string $incomingJson): string {
        $incoming = json_decode($incomingJson, true) ?: [];
        $current = json_decode($c->getData() ?? '{}', true) ?: [];
        // The browser's copy of discord has no webhookUrl; restore it.
        if (isset($current['discord']['webhookUrl'])) {
            $incoming['discord'] = $incoming['discord'] ?? [];
            $incoming['discord']['webhookUrl'] = $current['discord']['webhookUrl'];
        }
        return json_encode($incoming);
    }

    private function ownedOr404(int $id): Campaign|JSONResponse {
        try {
            $c = $this->mapper->find($id);
        } catch (DoesNotExistException) {
            return new JSONResponse(['error' => 'not found'], Http::STATUS_NOT_FOUND);
        }
        if ($c->getOwner() !== $this->userId) {
            return new JSONResponse(['error' => 'forbidden'], Http::STATUS_FORBIDDEN);
        }
        return $c;
    }
}
