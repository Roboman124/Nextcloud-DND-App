<?php
declare(strict_types=1);

namespace OCA\Grimoire\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<Scene>
 */
class SceneMapper extends QBMapper {
    public function __construct(IDBConnection $db) {
        parent::__construct($db, 'grimoire_scenes', Scene::class);
    }

    /** @return Scene[] */
    public function findForCampaign(int $campaignId): array {
        $qb = $this->db->getQueryBuilder();
        $qb->select('*')->from($this->getTableName())
            ->where($qb->expr()->eq('campaign_id',
                $qb->createNamedParameter($campaignId, IQueryBuilder::PARAM_INT)));
        return $this->findEntities($qb);
    }

    public function find(int $id): Scene {
        $qb = $this->db->getQueryBuilder();
        $qb->select('*')->from($this->getTableName())
            ->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
        return $this->findEntity($qb);
    }
}
