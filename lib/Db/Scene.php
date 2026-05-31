<?php
declare(strict_types=1);

namespace OCA\Grimoire\Db;

use OCP\AppFramework\Db\Entity;

/**
 * A scene is one tabletop layout inside a campaign. `mode` is '2d' or '3d'.
 * `data` is a JSON blob holding the full scene graph: tokens, drawings, fog,
 * map references, AoE templates, camera. Keeping it as one document keeps the
 * schema simple and lets the frontend own the format; the relay only diffs it.
 *
 * @method int getCampaignId()
 * @method void setCampaignId(int $campaignId)
 * @method string getName()
 * @method void setName(string $name)
 * @method string getMode()
 * @method void setMode(string $mode)
 * @method string getData()
 * @method void setData(string $data)
 */
class Scene extends Entity implements \JsonSerializable {
    protected $campaignId = 0;
    protected $name = '';
    protected $mode = '2d';
    protected $data = '{}';

    public function __construct() {
        $this->addType('campaignId', 'integer');
        $this->addType('name', 'string');
        $this->addType('mode', 'string');
        $this->addType('data', 'string');
    }

    public function jsonSerialize(): array {
        return [
            'id' => $this->id,
            'campaignId' => $this->campaignId,
            'name' => $this->name,
            'mode' => $this->mode,
            'data' => json_decode($this->data ?: '{}', true),
        ];
    }
}
