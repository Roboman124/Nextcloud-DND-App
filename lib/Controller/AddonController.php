<?php
declare(strict_types=1);

namespace OCA\Grimoire\Controller;

use OCA\Grimoire\AppInfo\Application;
use OCA\Grimoire\Db\Addon;
use OCA\Grimoire\Db\AddonMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\OCSController;
use OCP\Http\Client\IClientService;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Installed-addon persistence and the addon store catalog.
 *
 *  - index()     : GET the current user's installed addons.
 *  - install()   : POST a manifest URL; fetches it to cache name/version, stores it.
 *  - uninstall() : DELETE an install by id.
 *  - store()     : GET the bundled community catalog (catalog/plugins.json).
 *
 * The manifest URL is the source of truth; name/version are cached for display.
 * Scoped per user so the list follows the account across devices.
 */
class AddonController extends OCSController {
    public function __construct(
        IRequest $request,
        private AddonMapper $mapper,
        private IClientService $clientService,
        private LoggerInterface $logger,
        private ?string $userId,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    #[NoAdminRequired]
    public function index(): JSONResponse {
        return new JSONResponse($this->mapper->findAllForUser($this->userId ?? ''));
    }

    /**
     * POST /api/addons  Body: manifestUrl
     */
    #[NoAdminRequired]
    public function install(string $manifestUrl = ''): JSONResponse {
        $url = trim($manifestUrl);
        if ($url === '' || !str_starts_with($url, 'https://')) {
            return new JSONResponse(['error' => 'A https manifest URL is required'], Http::STATUS_BAD_REQUEST);
        }
        // Already installed? Return the existing row.
        $existing = $this->mapper->findForUserByUrl($this->userId ?? '', $url);
        if ($existing) {
            return new JSONResponse($existing);
        }

        // Fetch the manifest to cache name/version (and validate it's reachable).
        $name = 'Addon';
        $version = '';
        try {
            $client = $this->clientService->newClient();
            $body = (string) $client->get($url, ['timeout' => 10])->getBody();
            $manifest = json_decode($body, true);
            if (is_array($manifest)) {
                $name = (string) ($manifest['name'] ?? $name);
                $version = (string) ($manifest['version'] ?? '');
            }
        } catch (\Throwable $e) {
            $this->logger->warning('Grimoire: addon manifest fetch failed', ['url' => $url, 'exception' => $e]);
            return new JSONResponse(['error' => 'Could not fetch that manifest URL'], Http::STATUS_BAD_GATEWAY);
        }

        $addon = new Addon();
        $addon->setUserId($this->userId ?? '');
        $addon->setManifestUrl($url);
        $addon->setName($name);
        $addon->setVersion($version);
        $addon->setEnabled('yes');
        return new JSONResponse($this->mapper->insert($addon));
    }

    #[NoAdminRequired]
    public function uninstall(int $id): JSONResponse {
        try {
            $addon = $this->mapper->find($id);
        } catch (DoesNotExistException) {
            return new JSONResponse([], Http::STATUS_NO_CONTENT);
        }
        if ($addon->getUserId() !== $this->userId) {
            return new JSONResponse(['error' => 'Forbidden'], Http::STATUS_FORBIDDEN);
        }
        $this->mapper->delete($addon);
        return new JSONResponse([], Http::STATUS_NO_CONTENT);
    }

    /**
     * GET /api/addons/store — the bundled community catalog of addons.
     * Each entry is validated against the required fields; valid entries get
     * `verified: true`, invalid ones are filtered out (with a warning logged)
     * so the store never offers a broken manifest reference.
     */
    #[NoAdminRequired]
    public function store(): JSONResponse {
        $path = __DIR__ . '/../../catalog/plugins.json';
        if (!is_file($path)) {
            return new JSONResponse(['plugins' => []]);
        }
        $data = json_decode((string) file_get_contents($path), true);
        if (!is_array($data)) {
            return new JSONResponse(['plugins' => []]);
        }
        $plugins = $data['plugins'] ?? [];
        $verified = [];
        foreach ($plugins as $p) {
            if ($this->validateCatalogEntry($p)) {
                $p['verified'] = true;
                $verified[] = $p;
            } else {
                $this->logger->warning('Grimoire: catalog entry failed validation', ['entry' => $p]);
            }
        }
        return new JSONResponse(['plugins' => $verified]);
    }

    /**
     * Minimal server-side validation of a catalog entry mirroring the JSON
     * schema in catalog/plugins.schema.json. Keeps the store self-checking
     * without a schema library dependency.
     */
    private function validateCatalogEntry($p): bool {
        if (!is_array($p)) return false;
        foreach (['name', 'author', 'description', 'manifestUrl'] as $f) {
            if (!isset($p[$f]) || !is_string($p[$f]) || $p[$f] === '') return false;
        }
        if (mb_strlen($p['name']) > 60 || mb_strlen($p['description']) > 280) return false;
        if (!str_starts_with($p['manifestUrl'], 'https://')) return false;
        $allowed = ['scene:read', 'scene:write', 'tool', 'broadcast', 'metadata', 'dice'];
        if (isset($p['permissions'])) {
            if (!is_array($p['permissions'])) return false;
            foreach ($p['permissions'] as $perm) {
                if (!in_array($perm, $allowed, true)) return false;
            }
        }
        return true;
    }
}
