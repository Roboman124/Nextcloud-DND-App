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
        if (!$this->canAccessCampaign($campaignId)) {
            return new JSONResponse(['message' => 'forbidden', 'error' => 'forbidden'], Http::STATUS_FORBIDDEN);
        }
        return new JSONResponse($this->scenes->findForCampaign($campaignId));
    }

    #[NoAdminRequired]
    public function create(int $campaignId, string $name, string $mode = '2d'): JSONResponse {
        if (!$this->ownsCampaign($campaignId)) {
            return new JSONResponse(['message' => 'forbidden', 'error' => 'forbidden'], Http::STATUS_FORBIDDEN);
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
    public function update(int $id, ?string $name = null, ?array $data = null, ?array $patch = null): JSONResponse {
        // Players may edit scene contents during play; creation and deletion
        // of scenes are owner-only. Saves arrive as a PATCH — only what the
        // client actually changed since it loaded the scene — merged item by
        // item under the campaign's permission table (create/update/delete,
        // ownerOnly on tokens). GM-only keys (name, grid config, the map, fog)
        // can never be touched or wiped by a player. The legacy `data` form is
        // interpreted as the same item ops against the current document, so a
        // stale or partial save cannot silently roll back or wipe items.
        $s = $this->accessibleOr404($id);
        if ($s instanceof JSONResponse) return $s;

        // Raw-body fallback: PUT param binding has proved unreliable on some
        // setups — a miss would throw a 400 on the (optional) params above,
        // so recover from the raw JSON body first.
        if ($name === null && $data === null && $patch === null) {
            $raw = json_decode((string) file_get_contents('php://input'), true);
            if (is_array($raw)) {
                if (isset($raw['name']) && is_scalar($raw['name'])) $name = (string) $raw['name'];
                if (isset($raw['data']) && is_array($raw['data'])) $data = $raw['data'];
                if (isset($raw['patch']) && is_array($raw['patch'])) $patch = $raw['patch'];
            }
        }

        $current = json_decode($s->getData() ?? '{}', true);
        if (!is_array($current) || array_is_list($current)) $current = [];

        if ($this->ownsCampaign($s->getCampaignId())) {
            if ($name !== null) $s->setName($name);
            if ($patch !== null) {
                $s->setData(json_encode(self::applyPatch($current, $patch)));
            } elseif ($data !== null) {
                $s->setData(json_encode($data));
            }
            return new JSONResponse($this->scenes->update($s));
        }

        $perms = $this->permissionsFor($s->getCampaignId());
        if ($patch === null && is_array($data)) {
            $patch = self::patchFromData($current, $data);
        }
        if ($patch !== null) {
            $s->setData(json_encode(self::applyPatch($current, $patch, $perms, $this->userId)));
        }
        return new JSONResponse($this->scenes->update($s));
    }

    /** Doc key -> permission layer. Keys absent here are GM-only (name,
     * gridConfig, fog…) or unknown — players can never touch them. */
    private const LAYER_BY_KEY = [
        'tokens' => 'tokens',
        'blocks' => 'maps',
        'maps' => 'maps',
        'mapUrl' => 'maps',
        'map2d' => 'maps',
        'map3d' => 'maps',
        'drawings' => 'drawings',
        'measurements' => 'drawings',
    ];

    /** A list whose entries are all objects with a string id (empty counts). */
    private static function isIdItemList(?array $arr): bool {
        if (!is_array($arr)) return false;
        foreach ($arr as $e) {
            if (!is_array($e) || !isset($e['id']) || !is_string($e['id'])) return false;
        }
        return true;
    }

    /** Stable deep-compare form: object keys sorted recursively. */
    private static function canon($v) {
        if (is_array($v)) {
            $out = [];
            foreach ($v as $k => $x) $out[$k] = self::canon($x);
            if (!array_is_list($out)) ksort($out);
            return $out;
        }
        return $v;
    }

    /**
     * Interpret a legacy wholesale `data` save as item ops against the current
     * document: changed/new entries are sets, entries the caller left out are
     * deletions, everything else is left alone. Non-id lists and scalars fall
     * back to whole-value writes.
     */
    private static function patchFromData(array $current, array $data): array {
        $patch = ['items' => [], 'values' => [], 'drop' => []];
        foreach ($data as $key => $value) {
            $cur = $current[$key] ?? null;
            $curList = is_array($cur) ? $cur : [];
            if (is_array($value) && self::isIdItemList($value) && self::isIdItemList($curList)) {
                $curById = [];
                foreach ($curList as $e) {
                    if (isset($e['id'])) $curById[$e['id']] = $e;
                }
                $set = [];
                $seen = [];
                foreach ($value as $e) {
                    $seen[$e['id']] = true;
                    $old = $curById[$e['id']] ?? null;
                    if ($old === null || self::canon($old) !== self::canon($e)) $set[] = $e;
                }
                $remove = [];
                foreach ($curById as $cid => $e) {
                    if (!isset($seen[$cid])) $remove[] = $cid;
                }
                if ($set || $remove) $patch['items'][$key] = ['set' => $set, 'remove' => $remove];
            } else {
                $patch['values'][$key] = $value;
            }
        }
        return $patch;
    }

    /**
     * Merge a patch into the current document.
     *
     * $perms === null (the owner/GM) applies everything. For players every
     * item op runs through the same per-item rules as the live push gate:
     * updates/deletes of owned tokens when ownerOnly is set, create/update/
     * delete only where the layer's flag allows. Denied ops are skipped — the
     * stored item stays as it was, so a save can never smuggle changes past
     * the permission table.
     */
    private static function applyPatch(array $current, array $patch, ?array $perms = null, ?string $userId = null): array {
        // A dropped whole key of id-listed items is a delete of each item —
        // route it through the per-item delete rules below.
        foreach (($patch['drop'] ?? []) as $key) {
            $cur = $current[$key] ?? null;
            if (self::isIdItemList(is_array($cur) ? $cur : null) && is_array($cur) && $cur !== []) {
                $ids = array_values(array_filter(array_map(fn ($e) => $e['id'] ?? null, $cur), 'is_string'));
                $patch['items'][$key]['remove'] = array_merge($patch['items'][$key]['remove'] ?? [], $ids);
            } else {
                $layer = self::LAYER_BY_KEY[$key] ?? null;
                if ($perms !== null && ($layer === null || !($perms[$layer]['delete'] ?? true))) continue;
                unset($current[$key]);
            }
        }

        foreach (($patch['items'] ?? []) as $key => $op) {
            if (!is_array($op)) continue;
            $layer = self::LAYER_BY_KEY[$key] ?? null;
            if ($perms !== null && $layer === null) continue; // GM-only key

            $keep = [];    // entries without an id stay untouched, in front
            $map = [];     // id => entry
            $order = [];   // id order
            foreach ((array) ($current[$key] ?? []) as $e) {
                if (is_array($e) && isset($e['id']) && is_string($e['id'])) {
                    if (!isset($map[$e['id']])) $order[] = $e['id'];
                    $map[$e['id']] = $e;
                } else {
                    $keep[] = $e;
                }
            }

            foreach (($op['set'] ?? []) as $e) {
                if (!is_array($e) || !isset($e['id']) || !is_string($e['id'])) continue;
                $exists = isset($map[$e['id']]);
                if ($perms !== null) {
                    $action = $exists ? 'update' : 'create';
                    if (!($perms[$layer][$action] ?? true)) continue;
                    if ($exists && ($perms[$layer]['ownerOnly'] ?? false)) {
                        $owner = $map[$e['id']]['owner'] ?? null;
                        if (!is_string($owner) || $owner === '' || $owner !== $userId) continue;
                    }
                }
                if (!$exists) $order[] = $e['id'];
                $map[$e['id']] = $e;
            }

            foreach (($op['remove'] ?? []) as $rid) {
                if (!is_string($rid) || !isset($map[$rid])) continue;
                if ($perms !== null) {
                    if (!($perms[$layer]['delete'] ?? true)) continue;
                    if (($perms[$layer]['ownerOnly'] ?? false)) {
                        $owner = $map[$rid]['owner'] ?? null;
                        if (!is_string($owner) || $owner === '' || $owner !== $userId) continue;
                    }
                }
                unset($map[$rid]);
                $order = array_values(array_filter($order, fn ($x) => $x !== $rid));
            }

            $merged = $keep;
            foreach ($order as $oid) $merged[] = $map[$oid];
            $current[$key] = $merged;
        }

        foreach (($patch['values'] ?? []) as $key => $value) {
            $layer = self::LAYER_BY_KEY[$key] ?? null;
            if ($perms !== null) {
                if ($layer === null) continue; // GM-only key
                if (!($perms[$layer]['update'] ?? true)) continue;
            }
            $current[$key] = $value;
        }
        return $current;
    }

    /** The campaign's per-layer player permission flags (defaults: all true). */
    private function permissionsFor(int $campaignId): array {
        try {
            $campaign = $this->campaigns->find($campaignId);
        } catch (DoesNotExistException) {
            return [];
        }
        $data = json_decode($campaign->getData() ?? '{}', true) ?: [];
        $perms = is_array($data['permissions'] ?? null) ? $data['permissions'] : [];
        $out = [];
        foreach (['maps', 'tokens', 'drawings', 'fog'] as $layer) {
            $out[$layer] = array_merge(
                ['create' => true, 'update' => true, 'delete' => true, 'ownerOnly' => false],
                $perms[$layer] ?? []
            );
        }
        return $out;
    }

    #[NoAdminRequired]
    public function destroy(int $id): JSONResponse {
        // Deleting a scene is owner-only.
        try {
            $s = $this->scenes->find($id);
        } catch (DoesNotExistException) {
            return new JSONResponse(['message' => 'not found', 'error' => 'not found'], Http::STATUS_NOT_FOUND);
        }
        if (!$this->ownsCampaign($s->getCampaignId())) {
            return new JSONResponse(['message' => 'forbidden', 'error' => 'forbidden'], Http::STATUS_FORBIDDEN);
        }
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

    /** Owner or invited player. */
    private function canAccessCampaign(int $campaignId): bool {
        try {
            $campaign = $this->campaigns->find($campaignId);
        } catch (DoesNotExistException) {
            return false;
        }
        if ($campaign->getOwner() === $this->userId) {
            return true;
        }
        $data = json_decode($campaign->getData() ?? '{}', true) ?: [];
        return in_array($this->userId, $data['players'] ?? [], true);
    }

    private function accessibleOr404(int $id): Scene|JSONResponse {
        try {
            $s = $this->scenes->find($id);
        } catch (DoesNotExistException) {
            return new JSONResponse(['message' => 'not found', 'error' => 'not found'], Http::STATUS_NOT_FOUND);
        }
        if (!$this->canAccessCampaign($s->getCampaignId())) {
            return new JSONResponse(['message' => 'forbidden', 'error' => 'forbidden'], Http::STATUS_FORBIDDEN);
        }
        return $s;
    }
}
