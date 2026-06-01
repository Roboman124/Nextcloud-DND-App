<?php
declare(strict_types=1);

namespace OCA\Grimoire\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<Campaign>
 */
class CampaignMapper extends QBMapper {
    public function __construct(IDBConnection $db) {
        parent::__construct($db, 'grimoire_campaigns', Campaign::class);
    }

    /** @return Campaign[] */
    public function findAllForUser(string $userId): array {
        $qb = $this->db->getQueryBuilder();
        $qb->select('*')->from($this->getTableName())
            ->where($qb->expr()->eq('owner', $qb->createNamedParameter($userId)))
            ->orderBy('created_at', 'DESC');
        return $this->findEntities($qb);
    }

    /**
     * Campaigns where $userId appears in the JSON data.players list (i.e. an
     * invited player who is not the owner). Player lists are stored as JSON, so
     * we use a LIKE pre-filter on the data column and confirm in PHP to avoid
     * a portable JSON-query dependency.
     *
     * @return Campaign[]
     */
    public function findSharedWithUser(string $userId): array {
        $qb = $this->db->getQueryBuilder();
        $qb->select('*')->from($this->getTableName())
            ->where($qb->expr()->neq('owner', $qb->createNamedParameter($userId)))
            ->andWhere($qb->expr()->like('data',
                $qb->createNamedParameter('%' . $this->db->escapeLikeParameter($userId) . '%')))
            ->orderBy('created_at', 'DESC');
        $candidates = $this->findEntities($qb);

        // Confirm the uid is actually in the players array (not just a substring
        // match somewhere else in the JSON).
        $out = [];
        foreach ($candidates as $c) {
            $data = json_decode($c->getData() ?? '{}', true) ?: [];
            $players = $data['players'] ?? [];
            if (in_array($userId, $players, true)) {
                $out[] = $c;
            }
        }
        return $out;
    }

    public function find(int $id): Campaign {
        $qb = $this->db->getQueryBuilder();
        $qb->select('*')->from($this->getTableName())
            ->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
        return $this->findEntity($qb);
    }
}
