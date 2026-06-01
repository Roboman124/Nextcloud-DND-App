<?php
declare(strict_types=1);

namespace OCA\Grimoire\Controller;

use OCA\Grimoire\AppInfo\Application;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Controller;
use OCP\Http\Client\IClientService;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Same-origin proxy for third-party addon files.
 *
 * Why this exists: addon UIs are third-party web pages with inline scripts.
 * Loading them cross-origin (raw.githubusercontent.com) fails because GitHub
 * sends X-Frame-Options: deny; loading them via blob:/srcdoc fails because a
 * sandboxed frame inherits Nextcloud's strict nonce CSP and blocks the inline
 * script. The only reliable fix is to serve the addon document from OUR origin
 * with a CSP WE control. This controller fetches the remote file server-side
 * and re-serves it with a relaxed CSP (unsafe-inline/eval) scoped to this one
 * response — so the addon's own inline scripts execute, while the rest of
 * Nextcloud keeps its strict policy.
 *
 * Security posture: the proxied document runs on our origin, so we deliberately
 * do NOT forward cookies, and we restrict which hosts may be proxied to an
 * allowlist of well-known static hosts. Addons still talk to the host app only
 * through the sandboxed postMessage SDK bridge.
 */
class AddonProxyController extends Controller {

    // Hosts we are willing to proxy addon files from.
    private const ALLOWED_HOSTS = [
        'raw.githubusercontent.com',
        'github.io',            // *.github.io (Pages)
        'gitlab.io',
        'codeberg.page',
        'pages.dev',            // Cloudflare Pages
        'netlify.app',
        'vercel.app',
    ];

    public function __construct(
        IRequest $request,
        private IClientService $clientService,
        private LoggerInterface $logger,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /**
     * GET /apps/grimoire/addon-proxy?url=<absolute https url>
     * Returns the remote file's bytes, served same-origin with a relaxed CSP
     * for HTML so the addon's inline scripts run.
     */
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function proxy(string $url = ''): DataDisplayResponse {
        if (!$this->isAllowed($url)) {
            return new DataDisplayResponse('Blocked: addon host not allowed', Http::STATUS_FORBIDDEN, ['Content-Type' => 'text/plain']);
        }

        try {
            $client = $this->clientService->newClient();
            $response = $client->get($url, ['timeout' => 12]);
            $body = (string) $response->getBody();
            $contentType = $this->contentTypeFor($url, $response->getHeader('Content-Type'));
        } catch (\Throwable $e) {
            $this->logger->warning('Grimoire: addon proxy fetch failed', ['url' => $url, 'exception' => $e]);
            return new DataDisplayResponse('Could not fetch addon file', Http::STATUS_BAD_GATEWAY, ['Content-Type' => 'text/plain']);
        }

        // If this is the addon's HTML entry, rewrite its relative asset/SDK URLs
        // to go back through this proxy too, so the whole addon stays same-origin.
        if (str_contains($contentType, 'text/html')) {
            $body = $this->rewriteHtml($body, $url);
        }

        $res = new DataDisplayResponse($body, Http::STATUS_OK, ['Content-Type' => $contentType]);

        // Relaxed CSP scoped to THIS response only — lets the addon's inline
        // scripts/styles run. The host app's pages keep Nextcloud's strict CSP.
        $csp = new ContentSecurityPolicy();
        $csp->allowInlineScript(true);
        $csp->allowEvalScript(true);
        $csp->allowInlineStyle(true);
        $csp->addAllowedScriptDomain('*');
        $csp->addAllowedStyleDomain('*');
        $csp->addAllowedConnectDomain('*');
        $csp->addAllowedImageDomain('*');
        $csp->addAllowedFontDomain('*');
        $res->setContentSecurityPolicy($csp);

        return $res;
    }

    private function isAllowed(string $url): bool {
        if ($url === '') {
            return false;
        }
        $parts = parse_url($url);
        if (!$parts || ($parts['scheme'] ?? '') !== 'https') {
            return false;
        }
        $host = strtolower($parts['host'] ?? '');
        foreach (self::ALLOWED_HOSTS as $allowed) {
            if ($host === $allowed || str_ends_with($host, '.' . $allowed)) {
                return true;
            }
        }
        return false;
    }

    private function contentTypeFor(string $url, string $remoteType): string {
        // raw.githubusercontent serves everything as text/plain; infer from the
        // extension so the browser treats HTML/JS/CSS correctly.
        $path = strtolower(parse_url($url, PHP_URL_PATH) ?: '');
        if (str_ends_with($path, '.html') || str_ends_with($path, '.htm')) return 'text/html; charset=utf-8';
        if (str_ends_with($path, '.js') || str_ends_with($path, '.mjs')) return 'text/javascript; charset=utf-8';
        if (str_ends_with($path, '.css')) return 'text/css; charset=utf-8';
        if (str_ends_with($path, '.json')) return 'application/json; charset=utf-8';
        if (str_ends_with($path, '.svg')) return 'image/svg+xml';
        if ($remoteType) return $remoteType;
        return 'application/octet-stream';
    }

    /** Rewrite relative URLs in the addon HTML to route through this proxy. */
    private function rewriteHtml(string $html, string $baseUrl): string {
        $base = preg_replace('#[^/]*$#', '', $baseUrl); // strip filename
        // Build the proxy URL prefix relative to this app route.
        $self = '/index.php/apps/grimoire/addon-proxy?url=';

        // Rewrite src="..."/href="..." that are relative (not absolute/scheme).
        $html = preg_replace_callback(
            '#\b(src|href)\s*=\s*"(?!https?://|//|data:|blob:|#)([^"]+)"#i',
            function ($m) use ($base, $self) {
                $abs = $base . ltrim($m[2], './');
                return $m[1] . '="' . $self . rawurlencode($abs) . '"';
            },
            $html
        );
        // Rewrite a relative SDK import in module scripts.
        $html = preg_replace_callback(
            '#from\s*([\'"])(?!https?://)(\./)?grimoire-sdk\.js\1#i',
            function ($m) use ($base, $self) {
                $abs = $base . 'grimoire-sdk.js';
                return 'from "' . $self . rawurlencode($abs) . '"';
            },
            $html
        );
        return $html;
    }
}
