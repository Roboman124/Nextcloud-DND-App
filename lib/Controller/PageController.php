<?php
declare(strict_types=1);

namespace OCA\Grimoire\Controller;

use OCA\Grimoire\AppInfo\Application;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IRequest;
use OCP\Util;

/**
 * Serves the single-page Vue app. Both the campaign browser and the live room
 * are the same SPA; the Vue router decides what to show based on the URL.
 */
class PageController extends Controller {
    public function __construct(
        IRequest $request,
        private IInitialState $initialState,
        private ?string $userId,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /**
     * @NoAdminRequired
     * @NoCSRFRequired
     */
    public function index(): TemplateResponse {
        Util::addStyle(Application::APP_ID, 'grimoire-style');
        Util::addScript(Application::APP_ID, 'grimoire-main');
        $this->initialState->provideInitialState('userId', $this->userId);

        $response = new TemplateResponse(Application::APP_ID, 'main');

        // Near-default policy. The old widening existed for the iframe addon
        // system (removed in 0.7.1) and the external WebSocket relay (removed
        // with the unified sync) — neither is needed any more. Assets (maps,
        // tokens, glTF) load from the user's own Nextcloud Files, i.e. this
        // origin; image/media stay permissive because a map URL may legitimately
        // point at any same-origin Files path and older scenes may reference
        // absolute asset URLs.
        $csp = new ContentSecurityPolicy();
        $csp->addAllowedImageDomain('*');
        $csp->addAllowedMediaDomain('*');
        $csp->addAllowedWorkerSrcDomain("'self'");
        $response->setContentSecurityPolicy($csp);
        return $response;
    }

    /**
     * @NoAdminRequired
     * @NoCSRFRequired
     */
    public function room(string $campaignId, string $sceneId): TemplateResponse {
        // Same SPA; the deep link is resolved client-side.
        return $this->index();
    }
}
