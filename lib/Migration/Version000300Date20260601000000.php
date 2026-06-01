<?php
declare(strict_types=1);

namespace OCA\Grimoire\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Creates grimoire_addons: per-user list of installed addons (manifest URL plus
 * cached name/version), so installs persist across sessions and devices.
 */
class Version000300Date20260601000000 extends SimpleMigrationStep {

    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        if (!$schema->hasTable('grimoire_addons')) {
            $table = $schema->createTable('grimoire_addons');
            $table->addColumn('id', 'integer', ['autoincrement' => true, 'notnull' => true]);
            $table->addColumn('user_id', 'string', ['notnull' => true, 'length' => 64]);
            $table->addColumn('manifest_url', 'string', ['notnull' => true, 'length' => 1024]);
            $table->addColumn('name', 'string', ['notnull' => false, 'length' => 255, 'default' => '']);
            $table->addColumn('version', 'string', ['notnull' => false, 'length' => 32, 'default' => '']);
            $table->addColumn('enabled', 'string', ['notnull' => false, 'length' => 8, 'default' => 'yes']);
            $table->setPrimaryKey(['id']);
            $table->addIndex(['user_id'], 'grimoire_addons_user');
        }

        return $schema;
    }
}
