<?php
declare(strict_types=1);

namespace OCA\Grimoire\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<Addon>
 */
class AddonMapper extends QBMapper {
    public function __construct(IDBConnection $db) {
        parent::__construct($db, 'grimoire_addons', Addon::class);
    }

    /** @return Addon[] */
    public function findAllForUser(string $userId): array {
        $qb = $this->db->getQueryBuilder();
        $qb->select('*')->from($this->getTableName())
            ->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
            ->orderBy('name', 'ASC');
        return $this->findEntities($qb);
    }

    public function findForUserByUrl(string $userId, string $url): ?Addon {
        $qb = $this->db->getQueryBuilder();
        $qb->select('*')->from($this->getTableName())
            ->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
            ->andWhere($qb->expr()->eq('manifest_url', $qb->createNamedParameter($url)));
        $rows = $this->findEntities($qb);
        return $rows[0] ?? null;
    }
}
