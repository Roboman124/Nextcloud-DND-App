<?php
declare(strict_types=1);

namespace OCA\Grimoire\Controller;

use OCA\Grimoire\AppInfo\Application;
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
use OCP\IUserManager;
use OCP\Mail\IMailer;
use Psr\Log\LoggerInterface;

/**
 * Session scheduling, player roster, email reminders, and Discord notifications.
 *
 *  - players()  : GET  the roster as {uid, displayName, email, hasEmail} so the
 *                 UI can show a real list and disable reminders for players
 *                 without an email on file.
 *  - remind()   : POST send an email reminder to all players, or to one player
 *                 when ?player=<uid> is given (individual reminders). Also fires
 *                 a Discord webhook if the campaign has "reminder" events on.
 *
 * Reminders use Nextcloud's built-in IMailer, so no extra SMTP wiring is needed
 * beyond whatever the admin already configured for the instance.
 */
class SessionController extends OCSController {
    public function __construct(
        IRequest $request,
        private CampaignMapper $mapper,
        private IUserManager $userManager,
        private IMailer $mailer,
        private DiscordService $discord,
        private IConfig $config,
        private Defaults $defaults,
        private LoggerInterface $logger,
        private ?string $userId,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /**
     * GET /api/campaigns/{id}/players
     * Returns the roster with display names and email availability.
     */
    #[NoAdminRequired]
    public function players(int $id): JSONResponse {
        $campaign = $this->ownedOr404($id);
        if ($campaign instanceof JSONResponse) {
            return $campaign;
        }
        $data = json_decode($campaign->getData() ?? '{}', true) ?: [];
        $players = $data['players'] ?? [];

        $roster = [];
        foreach ($players as $uid) {
            $user = $this->userManager->get($uid);
            $roster[] = [
                'uid' => $uid,
                'displayName' => $user ? $user->getDisplayName() : $uid,
                'hasEmail' => $user ? (bool) $user->getEMailAddress() : false,
                'exists' => (bool) $user,
            ];
        }
        return new JSONResponse($roster);
    }

    /**
     * POST /api/campaigns/{id}/remind
     *
     * Body: sessionAt, message, optional player (uid) to remind just one.
     * Sends email to each eligible player and (if enabled) posts to Discord.
     */
    #[NoAdminRequired]
    public function remind(int $id, string $sessionAt = '', string $message = '', string $player = ''): JSONResponse {
        $campaign = $this->ownedOr404($id);
        if ($campaign instanceof JSONResponse) {
            return $campaign;
        }

        $data = json_decode($campaign->getData() ?? '{}', true) ?: [];
        $players = $data['players'] ?? [];

        // Narrow to a single player for individual reminders.
        if ($player !== '') {
            if (!in_array($player, $players, true)) {
                return new JSONResponse(['error' => 'Player not in campaign'], Http::STATUS_BAD_REQUEST);
            }
            $players = [$player];
        }

        if (empty($players)) {
            return new JSONResponse(['error' => 'No players to notify'], Http::STATUS_BAD_REQUEST);
        }

        $when = $this->formatWhen($sessionAt);
        $sent = [];
        $skipped = [];

        foreach ($players as $playerUid) {
            $user = $this->userManager->get($playerUid);
            if (!$user) {
                $skipped[] = $playerUid . ' (user not found)';
                continue;
            }
            $email = $user->getEMailAddress();
            if (!$email) {
                $skipped[] = $playerUid . ' (no email)';
                continue;
            }

            $mail = $this->mailer->createMessage();
            // A From address is required — without it many SMTP servers reject
            // the message. Use the admin-configured mail_from, falling back to
            // no-reply@<domain> derived from the instance URL.
            $mail->setFrom([$this->systemFromAddress() => $this->defaults->getName()]);
            $mail->setTo([$email => $user->getDisplayName()]);
            $mail->setSubject("Session reminder: {$campaign->getTitle()}");
            $mail->setPlainTextBody($this->buildEmailBody($campaign->getTitle(), $when, $message, $user->getDisplayName()));
            $mail->setHtmlBody($this->buildHtmlBody($campaign->getTitle(), $when, $message, $user->getDisplayName()));

            try {
                $this->mailer->send($mail);
                $sent[] = $playerUid;
            } catch (\Throwable $e) {
                // Surface the real reason instead of a generic "(send error)".
                $this->logger->error('Grimoire: reminder email failed', ['exception' => $e]);
                $skipped[] = $playerUid . ' (' . $e->getMessage() . ')';
            }
        }

        // Fire a Discord notification if this campaign has reminders enabled.
        $discordPosted = false;
        if ($this->discord->isEventEnabled($data, 'reminder')) {
            $title = $campaign->getTitle();
            $text = "📅 **Session reminder — {$title}**";
            if ($when) {
                $text .= "\nWhen: {$when}";
            }
            if ($message) {
                $text .= "\n{$message}";
            }
            $discordPosted = $this->discord->post($data, $text);
        }

        return new JSONResponse([
            'sent' => $sent,
            'skipped' => $skipped,
            'discordPosted' => $discordPosted,
        ]);
    }

    /**
     * The system "from" email. Nextcloud stores the local part in mail_from_address
     * and the domain in mail_domain; if unset, derive a no-reply address from the
     * instance's overwrite.cli.url so the message always has a valid sender.
     */
    private function systemFromAddress(): string {
        $local = $this->config->getSystemValue('mail_from_address', '');
        $domain = $this->config->getSystemValue('mail_domain', '');
        if ($local && $domain) {
            return $local . '@' . $domain;
        }
        // Fallback: no-reply@<host-from-instance-url>
        $url = $this->config->getSystemValue('overwrite.cli.url', 'http://localhost');
        $host = parse_url($url, PHP_URL_HOST) ?: 'localhost';
        return 'no-reply@' . $host;
    }

    private function ownedOr404(int $id): \OCA\Grimoire\Db\Campaign|JSONResponse {
        try {
            $campaign = $this->mapper->find($id);
        } catch (DoesNotExistException) {
            return new JSONResponse(['error' => 'Campaign not found'], Http::STATUS_NOT_FOUND);
        }
        if ($campaign->getOwner() !== $this->userId) {
            return new JSONResponse(['error' => 'Forbidden'], Http::STATUS_FORBIDDEN);
        }
        return $campaign;
    }

    private function formatWhen(string $sessionAt): string {
        if (!$sessionAt) {
            return '';
        }
        try {
            return (new \DateTime($sessionAt))->format('l, F j \a\t g:i A');
        } catch (\Exception) {
            return $sessionAt;
        }
    }

    private function buildEmailBody(string $campaign, string $when, string $message, string $name): string {
        $lines = ["Hi {$name},", ''];
        $lines[] = "You have an upcoming session for campaign \"{$campaign}\".";
        if ($when) {
            $lines[] = "When: {$when}";
        }
        if ($message) {
            $lines[] = '';
            $lines[] = $message;
        }
        $lines[] = '';
        $lines[] = 'See you at the table!';
        return implode("\n", $lines);
    }

    private function buildHtmlBody(string $campaign, string $when, string $message, string $name): string {
        $safeCampaign = htmlspecialchars($campaign);
        $safeWhen = htmlspecialchars($when);
        $safeMsg = htmlspecialchars($message);
        $safeName = htmlspecialchars($name);
        $html = "<p>Hi <strong>{$safeName}</strong>,</p>";
        $html .= "<p>You have an upcoming session for campaign <strong>{$safeCampaign}</strong>.</p>";
        if ($safeWhen) {
            $html .= "<p><strong>When:</strong> {$safeWhen}</p>";
        }
        if ($safeMsg) {
            $html .= "<p>{$safeMsg}</p>";
        }
        $html .= "<p>See you at the table! 🎲</p>";
        return $html;
    }
}
