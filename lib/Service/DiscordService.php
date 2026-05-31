<?php
declare(strict_types=1);

namespace OCA\Grimoire\Service;

use OCP\Http\Client\IClientService;
use Psr\Log\LoggerInterface;

/**
 * Posts messages to a campaign's Discord webhook.
 *
 * Configuration lives in the campaign's stored JSON `data` under a "discord"
 * key, e.g.:
 *
 *   "discord": {
 *     "webhookUrl": "https://discord.com/api/webhooks/.../...",
 *     "events": { "reminder": true, "dice": false, "join": true }
 *   }
 *
 * The webhook URL is never sent to the browser (see CampaignController, which
 * strips it from API responses); only the on/off event flags are exposed to the
 * UI. Outbound requests go through Nextcloud's HTTP client so proxy and TLS
 * settings are respected.
 */
class DiscordService {
    public function __construct(
        private IClientService $clientService,
        private LoggerInterface $logger,
    ) {
    }

    /** True if the campaign data enables Discord notifications for $event. */
    public function isEventEnabled(array $campaignData, string $event): bool {
        $discord = $campaignData['discord'] ?? null;
        if (!is_array($discord)) {
            return false;
        }
        if (empty($discord['webhookUrl'])) {
            return false;
        }
        $events = $discord['events'] ?? [];
        return !empty($events[$event]);
    }

    /**
     * Post a plain-text content message to the campaign's webhook.
     * Returns true on a 2xx response, false otherwise (never throws).
     */
    public function post(array $campaignData, string $content): bool {
        $discord = $campaignData['discord'] ?? null;
        $url = $discord['webhookUrl'] ?? '';
        if (!$this->isValidWebhook($url)) {
            return false;
        }

        try {
            $client = $this->clientService->newClient();
            $response = $client->post($url, [
                'json' => [
                    'content' => mb_substr($content, 0, 1900), // Discord 2000-char cap
                    'username' => 'Grimoire',
                ],
                'timeout' => 8,
            ]);
            $status = $response->getStatusCode();
            return $status >= 200 && $status < 300;
        } catch (\Throwable $e) {
            $this->logger->warning('Grimoire: Discord webhook post failed', ['exception' => $e]);
            return false;
        }
    }

    /** Only accept real Discord webhook URLs — guards against SSRF via the field. */
    public function isValidWebhook(string $url): bool {
        if ($url === '') {
            return false;
        }
        $parts = parse_url($url);
        if (!$parts || ($parts['scheme'] ?? '') !== 'https') {
            return false;
        }
        $host = strtolower($parts['host'] ?? '');
        return $host === 'discord.com'
            || $host === 'discordapp.com'
            || str_ends_with($host, '.discord.com');
    }
}
