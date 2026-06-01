<?php
declare(strict_types=1);

namespace OCA\Grimoire\Db;

use OCP\AppFramework\Db\Entity;

/**
 * A user's installed addon. Stores the manifest URL (the source of truth) plus
 * a cached name/version for display without re-fetching. Scoped per user so an
 * install list follows the account across devices.
 *
 * @method string getUserId()
 * @method void setUserId(string $v)
 * @method string getManifestUrl()
 * @method void setManifestUrl(string $v)
 * @method string getName()
 * @method void setName(string $v)
 * @method string getVersion()
 * @method void setVersion(string $v)
 * @method string getEnabled()
 * @method void setEnabled(string $v)
 */
class Addon extends Entity implements \JsonSerializable {
    protected $userId = '';
    protected $manifestUrl = '';
    protected $name = '';
    protected $version = '';
    protected $enabled = 'yes';

    public function jsonSerialize(): array {
        return [
            'id' => $this->id,
            'manifestUrl' => $this->manifestUrl,
            'name' => $this->name,
            'version' => $this->version,
            'enabled' => $this->enabled === 'yes',
        ];
    }
}
