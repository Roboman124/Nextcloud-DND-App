<?php
declare(strict_types=1);

namespace OCA\Grimoire\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Initial schema: campaigns and scenes. Bump the app <version> in info.xml to
 * trigger new migrations as the schema evolves.
 */
class Version000100Date20260101000000 extends SimpleMigrationStep {

    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        if (!$schema->hasTable('grimoire_campaigns')) {
            $t = $schema->createTable('grimoire_campaigns');
            $t->addColumn('id', 'integer', ['autoincrement' => true, 'notnull' => true]);
            $t->addColumn('title', 'string', ['notnull' => true, 'length' => 255]);
            $t->addColumn('owner', 'string', ['notnull' => true, 'length' => 64]);
            $t->addColumn('description', 'text', ['notnull' => false]);
            $t->addColumn('created_at', 'string', ['notnull' => false, 'length' => 32]);
            $t->setPrimaryKey(['id']);
            $t->addIndex(['owner'], 'grimoire_camp_owner_idx');
        }

        if (!$schema->hasTable('grimoire_scenes')) {
            $t = $schema->createTable('grimoire_scenes');
            $t->addColumn('id', 'integer', ['autoincrement' => true, 'notnull' => true]);
            $t->addColumn('campaign_id', 'integer', ['notnull' => true]);
            $t->addColumn('name', 'string', ['notnull' => true, 'length' => 255]);
            $t->addColumn('mode', 'string', ['notnull' => true, 'length' => 4, 'default' => '2d']);
            $t->addColumn('data', 'text', ['notnull' => false]);
            $t->setPrimaryKey(['id']);
            $t->addIndex(['campaign_id'], 'grimoire_scene_camp_idx');
        }

        return $schema;
    }
}
