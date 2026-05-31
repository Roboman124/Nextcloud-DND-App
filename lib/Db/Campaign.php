<?php
declare(strict_types=1);

namespace OCA\Grimoire\Db;

use OCP\AppFramework\Db\Entity;

/**
 * A campaign groups scenes and players under one game.
 *
 * @method string getTitle()
 * @method void setTitle(string $title)
 * @method string getOwner()
 * @method void setOwner(string $owner)
 * @method string getDescription()
 * @method void setDescription(string $description)
 * @method string getCreatedAt()
 * @method void setCreatedAt(string $createdAt)
 * @method string|null getData()
 * @method void setData(?string $data)
 */
class Campaign extends Entity implements \JsonSerializable {
    protected $title = '';
    protected $owner = '';
    protected $description = '';
    protected $createdAt = '';
    protected $data = null;

    public function __construct() {
        $this->addType('title', 'string');
        $this->addType('owner', 'string');
        $this->addType('description', 'string');
        $this->addType('createdAt', 'string');
        $this->addType('data', 'string');
    }

    public function jsonSerialize(): array {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'owner' => $this->owner,
            'description' => $this->description,
            'createdAt' => $this->createdAt,
            'data' => $this->data,
        ];
    }
}
