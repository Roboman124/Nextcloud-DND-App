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
use OCP\Defaults;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserManager;
use OCP\Mail\IMailer;
use Psr\Log\LoggerInterface;

/**
 * CRUD for campaigns, scoped to the logged-in user. Ownership is checked on
 * every read/write so users can only touch their own games.
 */
class CampaignController extends OCSController {
    public function __construct(
        IRequest $request,
        private CampaignMapper $mapper,
        private DiscordService $discord,
        private IUserManager $userManager,
        private IMailer $mailer,
        private IConfig $config,
        private Defaults $defaults,
        private IURLGenerator $urlGenerator,
        private LoggerInterface $logger,
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
    public function update(int $id, string $title = '', string $description = '', ?string $data = null): JSONResponse {
        $c = $this->ownedOr404($id);
        if ($c instanceof JSONResponse) return $c;

        // PUT body params have proved unreliable on some setups (the invite
        // saga): if the framework didn't bind them, recover from the raw
        // request body so a save can't silently drop the players list.
        if ($title === '' && $data === null) {
            $raw = json_decode((string) file_get_contents('php://input'), true);
            if (is_array($raw)) {
                if (isset($raw['title']) && is_scalar($raw['title'])) $title = (string) $raw['title'];
                if (isset($raw['description']) && is_scalar($raw['description'])) $description = (string) $raw['description'];
                if (isset($raw['data'])) $data = (string) $raw['data'];
            }
        }

        if ($title !== '') $c->setTitle($title);
        $c->setDescription($description);
        if ($data !== null && $data !== '') {
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
     * PUT /api/campaigns/{id}/players
     * Body: add (uid) | remove (uid). GM-only: invite or uninvite a player.
     * Players are stored as a JSON array on the campaign's data column.
     *
     * Invites are validated (the user must exist and not be the owner) and an
     * invitation email is sent on add — best-effort; a missing address never
     * blocks the invite itself. A PUT body-binding miss would otherwise behave
     * like the old invite saga (200, nothing persisted), so fall back to the
     * raw JSON body when no param arrives.
     */
    #[NoAdminRequired]
    public function players(int $id, string $add = '', string $remove = ''): JSONResponse {
        $c = $this->ownedOr404($id);
        if ($c instanceof JSONResponse) return $c;

        if ($add === '' && $remove === '') {
            $raw = json_decode((string) file_get_contents('php://input'), true);
            if (is_array($raw)) {
                if (isset($raw['add']) && is_scalar($raw['add'])) $add = trim((string) $raw['add']);
                if (isset($raw['remove']) && is_scalar($raw['remove'])) $remove = trim((string) $raw['remove']);
            }
        }
        if ($add === '' && $remove === '') {
            return new JSONResponse(['error' => 'add or remove uid is required'], Http::STATUS_BAD_REQUEST);
        }

        $data = json_decode($c->getData() ?? '{}', true) ?: [];
        $players = is_array($data['players'] ?? null) ? $data['players'] : [];

        if ($add !== '') {
            if ($add === $this->userId) {
                return new JSONResponse(['error' => 'You already own this campaign'], Http::STATUS_BAD_REQUEST);
            }
            if (!$this->userManager->get($add)) {
                return new JSONResponse(['error' => 'No such user'], Http::STATUS_BAD_REQUEST);
            }
            if (!in_array($add, $players, true)) {
                $players[] = $add;
                $this->sendInviteMail($c, $add);
            }
        }
        if ($remove !== '') {
            $players = array_values(array_filter($players, static fn($u) => $u !== $remove));
        }
        $data['players'] = $players;
        $c->setData(json_encode($data));
        $this->mapper->update($c);
        return new JSONResponse($this->sanitize($c));
    }

    /** Email an invitation. Best-effort: false when impossible or it failed. */
    private function sendInviteMail(Campaign $c, string $uid): bool {
        $user = $this->userManager->get($uid);
        $email = $user?->getEMailAddress();
        if (!$email) return false;
        try {
            $link = $this->urlGenerator->linkToRouteAbsolute('grimoire.page.index');
        } catch (\Throwable) {
            $link = '';
        }
        $title = $c->getTitle();
        $name = $user->getDisplayName() ?: $uid;
        $inviter = $this->userId ?? 'A GM';
        $mail = $this->mailer->createMessage();
        $mail->setFrom([$this->systemFromAddress() => $this->defaults->getName()]);
        $mail->setTo([$email => $name]);
        $mail->setSubject("You're invited to {$title}");
        $mail->setPlainBody(
            "Hi {$name},\n\n" .
            "{$inviter} invited you to the campaign \"{$title}\" on Grimoire.\n\n" .
            ($link ? "Open the table: {$link}\n\n" : '') .
            "See you at the table!"
        );
        $safeName = htmlspecialchars($name);
        $safeTitle = htmlspecialchars($title);
        $safeInviter = htmlspecialchars((string) $inviter);
        $safeLink = htmlspecialchars($link);
        $mail->setHtmlBody(
            "<p>Hi <strong>{$safeName}</strong>,</p>" .
            "<p><strong>{$safeInviter}</strong> invited you to the campaign <strong>{$safeTitle}</strong> on Grimoire.</p>" .
            ($link ? "<p><a href=\"{$safeLink}\">Open the table</a></p>" : '') .
            "<p>See you at the table! 🎲</p>"
        );
        try {
            $this->mailer->send($mail);
            return true;
        } catch (\Throwable $e) {
            $this->logger->error('Grimoire: invite email failed', ['exception' => $e]);
            return false;
        }
    }

    /**
     * The system "from" email: mail_from_address@mail_domain, or a no-reply
     * address derived from overwrite.cli.url when unset.
     */
    private function systemFromAddress(): string {
        $local = $this->config->getSystemValue('mail_from_address', '');
        $domain = $this->config->getSystemValue('mail_domain', '');
        if ($local && $domain) {
            return $local . '@' . $domain;
        }
        $url = $this->config->getSystemValue('overwrite.cli.url', 'http://localhost');
        $host = parse_url($url, PHP_URL_HOST) ?: 'localhost';
        return 'no-reply@' . $host;
    }

    /**
     * PUT /api/campaigns/{id}/permissions
     * Body: permissions (object of per-layer create/update/delete bools).
     * GM-only. Stored on the campaign data; the room reads it via the token
     * endpoint or campaign show and enforces it client + server side.
     */
    #[NoAdminRequired]
    public function permissions(int $id, ?array $permissions = null): JSONResponse {
        $c = $this->ownedOr404($id);
        if ($c instanceof JSONResponse) return $c;
        // PUT body binding has been unreliable on some setups: a miss here
        // would default EVERY layer to all-true and silently wipe the saved
        // permission table. Fall back to the raw JSON body.
        if ($permissions === null) {
            $raw = json_decode((string) file_get_contents('php://input'), true);
            if (is_array($raw) && isset($raw['permissions']) && is_array($raw['permissions'])) {
                $permissions = $raw['permissions'];
            }
        }
        if ($permissions === null) {
            // Still nothing — refuse rather than silently saving an all-true
            // table over the existing permissions.
            return new JSONResponse(['error' => 'permissions object is required'], Http::STATUS_BAD_REQUEST);
        }
        $data = json_decode($c->getData() ?? '{}', true) ?: [];
        // Normalize: each layer is {create,update,delete} bools; default true
        // for backward compat (players could always move tokens before).
        $layers = ['maps', 'tokens', 'drawings', 'fog'];
        $norm = [];
        foreach ($layers as $layer) {
            $incoming = $permissions[$layer] ?? null;
            if (!is_array($incoming)) {
                $norm[$layer] = ['create' => true, 'update' => true, 'delete' => true];
                continue;
            }
            $norm[$layer] = [
                'create' => (bool) ($incoming['create'] ?? true),
                'update' => (bool) ($incoming['update'] ?? true),
                'delete' => (bool) ($incoming['delete'] ?? true),
                'ownerOnly' => (bool) ($incoming['ownerOnly'] ?? false),
            ];
        }
        $data['permissions'] = $norm;
        $c->setData(json_encode($data));
        $this->mapper->update($c);
        return new JSONResponse($norm);
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
