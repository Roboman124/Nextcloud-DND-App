<?php
declare(strict_types=1);

namespace OCA\Grimoire\Controller;

use OCA\Grimoire\AppInfo\Application;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\OCSController;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Asset library — browse the logged-in user's Nextcloud Files for maps, token
 * images, and glTF/GLB models, with thumbnail URLs the frontend can render.
 *
 * This is the self-hosting payoff: your maps and tokens live in your storage,
 * not a third-party CDN. The frontend asks for a directory listing; we return
 * files with direct WebDAV URLs and, for images, a preview URL Nextcloud can
 * render on the fly.
 */
class AssetController extends OCSController {
    private const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'];
    private const MODEL_EXT = ['gltf', 'glb'];
    private const MAP_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'];

    public function __construct(
        IRequest $request,
        private IRootFolder $rootFolder,
        private LoggerInterface $logger,
        private ?string $userId,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /**
     * GET /api/assets?path=/Pictures/maps&kind=map|token|model
     * Returns the files in the given user folder, filtered by kind, each with
     * a direct download URL and (for images) a preview URL.
     */
    #[NoAdminRequired]
    public function index(string $path = '/', string $kind = 'all'): JSONResponse {
        try {
            $userFolder = $this->rootFolder->getUserFolder($this->userId);
        } catch (\Throwable $e) {
            return new JSONResponse(['error' => 'No user folder'], Http::STATUS_NOT_FOUND);
        }

        try {
            $node = $path === '/' ? $userFolder : $userFolder->get($path);
        } catch (NotFoundException) {
            return new JSONResponse(['error' => 'Not found', 'path' => $path], Http::STATUS_NOT_FOUND);
        } catch (\Throwable $e) {
            return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
        }

        $files = [];
        if ($node instanceof \OCP\Files\Folder) {
            foreach ($node->getDirectoryListing() as $child) {
                if ($child instanceof \OCP\Files\Folder) {
                    $files[] = [
                        'name' => $child->getName(),
                        'path' => $child->getInternalPath(),
                        'type' => 'folder',
                    ];
                    continue;
                }
                $ext = strtolower(pathinfo($child->getName(), PATHINFO_EXTENSION));
                if (!$this->matchesKind($ext, $kind)) continue;
                $files[] = [
                    'name' => $child->getName(),
                    'path' => $child->getInternalPath(),
                    'type' => 'file',
                    'ext' => $ext,
                    'size' => $child->getSize(),
                    'url' => $this->webdavUrl($child->getInternalPath()),
                    'preview' => $this->isImage($ext)
                        ? $this->previewUrl($child->getInternalPath(), 256, 256)
                        : null,
                    'isModel' => in_array($ext, self::MODEL_EXT, true),
                    'isImage' => $this->isImage($ext),
                ];
            }
        }

        // Sort: folders first, then files by name.
        usort($files, static function ($a, $b) {
            if ($a['type'] !== $b['type']) return $a['type'] === 'folder' ? -1 : 1;
            return strcasecmp($a['name'], $b['name']);
        });

        return new JSONResponse([
            'path' => $path,
            'parent' => $this->parentPath($path),
            'files' => $files,
        ]);
    }

    /**
     * GET /api/assets/file?path=...
     * Streams a file's bytes (with auth) so the frontend can load maps,
     * token images, and glTF models from the user's storage without needing
     * a raw /remote.php/webdav URL.
     */
    #[NoAdminRequired]
    public function file(string $path = ''): DataDisplayResponse {
        try {
            $userFolder = $this->rootFolder->getUserFolder($this->userId);
            $file = $userFolder->get($path);
            if (!($file instanceof \OCP\Files\File)) {
                return new DataDisplayResponse('Not a file', Http::STATUS_NOT_FOUND, ['Content-Type' => 'text/plain']);
            }
            $res = new DataDisplayResponse(
                $file->getContent(),
                Http::STATUS_OK,
                ['Content-Type' => $file->getMimeType()]
            );
            $res->cacheFor(3600);
            return $res;
        } catch (\Throwable $e) {
            $this->logger->warning('Grimoire: asset file serve failed', ['path' => $path, 'exception' => $e]);
            return new DataDisplayResponse('Not found', Http::STATUS_NOT_FOUND, ['Content-Type' => 'text/plain']);
        }
    }

    /**
     * GET /api/assets/thumbnail?path=...&w=128&h=128
     * Streams a server-rendered thumbnail of an image file. Falls back to a
     * 1x1 transparent pixel for non-image files so the frontend can request
     * a thumbnail for any asset without branching.
     */
    #[NoAdminRequired]
    public function thumbnail(string $path = '', int $w = 128, int $h = 128): DataDisplayResponse {
        try {
            $userFolder = $this->rootFolder->getUserFolder($this->userId);
            $file = $userFolder->get($path);
            if (!($file instanceof \OCP\Files\File)) {
                return $this->emptyPixel();
            }
            $ext = strtolower(pathinfo($file->getName(), PATHINFO_EXTENSION));
            if (!$this->isImage($ext)) {
                // Models: render a placeholder thumbnail so the asset grid has
                // a consistent card. A tiny SVG cube icon keeps it cheap.
                return $this->modelPlaceholder($file->getName());
            }
            // Stream the raw image; the browser scales it. Real thumbnail
            // generation via the preview manager would be ideal but the API
            // surface differs across Nextcloud versions; a direct serve is
            // portable and fast enough for a per-user asset browser.
            $res = new DataDisplayResponse(
                $file->getContent(),
                Http::STATUS_OK,
                ['Content-Type' => $file->getMimeType()]
            );
            $csp = new ContentSecurityPolicy();
            $res->setContentSecurityPolicy($csp);
            // Cache for a day.
            $res->cacheFor(86400);
            return $res;
        } catch (\Throwable $e) {
            return $this->emptyPixel();
        }
    }

    private function matchesKind(string $ext, string $kind): bool {
        if ($kind === 'all') return true;
        if ($kind === 'map') return in_array($ext, self::MAP_EXT, true);
        if ($kind === 'token') return $this->isImage($ext);
        if ($kind === 'model') return in_array($ext, self::MODEL_EXT, true);
        return true;
    }

    private function isImage(string $ext): bool {
        return in_array($ext, self::IMAGE_EXT, true);
    }

    private function webdavUrl(string $internalPath): string {
        return '/index.php/apps/grimoire/api/assets/file?path=' . rawurlencode($internalPath);
    }

    /**
     * A direct-file download URL routed through this controller so we can
     * apply Nextcloud auth (the raw /remote.php/webdav path needs the user's
     * auth too, but routing through the app keeps CSP + session handling
     * uniform and works under pretty-URL or not).
     */
    private function previewUrl(string $internalPath, int $w, int $h): string {
        return '/index.php/apps/grimoire/api/assets/thumbnail?path='
            . rawurlencode($internalPath) . '&w=' . $w . '&h=' . $h;
    }

    private function parentPath(string $path): string {
        if ($path === '/' || $path === '') return '/';
        $parts = explode('/', trim($path, '/'));
        array_pop($parts);
        return '/' . implode('/', $parts);
    }

    private function emptyPixel(): DataDisplayResponse {
        $bin = base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
        $res = new DataDisplayResponse($bin, Http::STATUS_OK, ['Content-Type' => 'image/gif']);
        $res->cacheFor(86400);
        return $res;
    }

    private function modelPlaceholder(string $name): DataDisplayResponse {
        $svg = '<?xml version="1.0" encoding="UTF-8"?>'
            . '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
            . '<rect width="128" height="128" fill="#1e2430"/>'
            . '<g fill="none" stroke="#c9a227" stroke-width="3">'
            . '<path d="M32 40 L96 40 L112 64 L64 96 L16 64 Z"/>'
            . '<path d="M32 40 L64 16 L96 40"/>'
            . '<path d="M16 64 L64 16 M112 64 L64 16"/>'
            . '</g></svg>';
        return new DataDisplayResponse($svg, Http::STATUS_OK, ['Content-Type' => 'image/svg+xml']);
    }
}