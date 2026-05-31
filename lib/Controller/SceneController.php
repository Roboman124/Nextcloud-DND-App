<?php
declare(strict_types=1);

namespace OCA\Grimoire\Controller;

use OCA\Grimoire\AppInfo\Application;
use OCA\Grimoire\Db\Scene;
use OCA\Grimoire\Db\SceneMapper;
use OCA\Grimoire\Db\CampaignMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/**
 * CRUD for scenes. The full scene graph is stored as a JSON document on the
 * row; the live room keeps the in-memory copy authoritative and persists
 * snapshots here so a refresh restores the table exactly.
 */
class SceneController extends OCSController {
    public function __construct(
        IRequest $request,
        private SceneMapper $scenes,
        private CampaignMapper $campaigns,
        private ?string $userId,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    #[NoAdminRequired]
    public function index(int $campaignId): JSONResponse {
        if (!$this->ownsCampaign($campaignId)) {
            return new JSONResponse(['error' => 'forbidden'], Http::STATUS_FORBIDDEN);
        }
        return new JSONResponse($this->scenes->findForCampaign($campaignId));
    }

    #[NoAdminRequired]
    public function create(int $campaignId, string $name, string $mode = '2d'): JSONResponse {
        if (!$this->ownsCampaign($campaignId)) {
            return new JSONResponse(['error' => 'forbidden'], Http::STATUS_FORBIDDEN);
        }
        $s = new Scene();
        $s->setCampaignId($campaignId);
        $s->setName($name);
        $s->setMode($mode === '3d' ? '3d' : '2d');
        $s->setData(json_encode(['tokens' => [], 'drawings' => [], 'fog' => null]));
        return new JSONResponse($this->scenes->insert($s));
    }

    #[NoAdminRequired]
    public function show(int $id): JSONResponse {
        $s = $this->accessibleOr404($id);
        return $s instanceof JSONResponse ? $s : new JSONResponse($s);
    }

    #[NoAdminRequired]
    public function update(int $id, ?string $name = null, ?array $data = null): JSONResponse {
        $s = $this->accessibleOr404($id);
        if ($s instanceof JSONResponse) return $s;
        if ($name !== null) $s->setName($name);
        if ($data !== null) $s->setData(json_encode($data));
        return new JSONResponse($this->scenes->update($s));
    }

    #[NoAdminRequired]
    public function destroy(int $id): JSONResponse {
        $s = $this->accessibleOr404($id);
        if ($s instanceof JSONResponse) return $s;
        $this->scenes->delete($s);
        return new JSONResponse([], Http::STATUS_NO_CONTENT);
    }

    private function ownsCampaign(int $campaignId): bool {
        try {
            return $this->campaigns->find($campaignId)->getOwner() === $this->userId;
        } catch (DoesNotExistException) {
            return false;
        }
    }

    private function accessibleOr404(int $id): Scene|JSONResponse {
        try {
            $s = $this->scenes->find($id);
        } catch (DoesNotExistException) {
            return new JSONResponse(['error' => 'not found'], Http::STATUS_NOT_FOUND);
        }
        if (!$this->ownsCampaign($s->getCampaignId())) {
            return new JSONResponse(['error' => 'forbidden'], Http::STATUS_FORBIDDEN);
        }
        return $s;
    }
}
