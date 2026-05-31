<?php
declare(strict_types=1);

namespace OCA\Grimoire\Controller;

use OCA\Grimoire\AppInfo\Application;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserManager;

/**
 * Lightweight user lookup for the "invite player" UI.
 *
 * The built-in provisioning API (/ocs/v1.php/cloud/users) is admin-only, so a
 * regular GM cannot use it to find players to invite. This endpoint wraps
 * IUserManager::searchDisplayName — available to any logged-in user — and
 * returns just {uid, displayName}, which is all the invite picker needs.
 */
class UserController extends OCSController {
    public function __construct(
        IRequest $request,
        private IUserManager $userManager,
        private ?string $userId,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /**
     * GET /api/users/search?q=...
     *
     * Returns up to $limit users whose display name or uid matches $q.
     */
    #[NoAdminRequired]
    public function search(string $q = '', int $limit = 8): JSONResponse {
        $q = trim($q);
        if (mb_strlen($q) < 2) {
            return new JSONResponse([]);
        }

        $results = [];
        // searchDisplayName matches on display name; also catch uid matches.
        foreach ($this->userManager->searchDisplayName($q, $limit) as $user) {
            $results[$user->getUID()] = [
                'uid' => $user->getUID(),
                'displayName' => $user->getDisplayName(),
            ];
        }
        foreach ($this->userManager->search($q, $limit) as $user) {
            $results[$user->getUID()] = [
                'uid' => $user->getUID(),
                'displayName' => $user->getDisplayName(),
            ];
        }

        return new JSONResponse(array_values($results));
    }
}
