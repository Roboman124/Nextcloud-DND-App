<?php
declare(strict_types=1);

namespace OCA\Grimoire\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Adds a JSON data column to grimoire_campaigns for storing session scheduling
 * info and player lists (UIDs of invited Nextcloud users).
 */
class Version000200Date20260531000000 extends SimpleMigrationStep {

    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        $table = $schema->getTable('grimoire_campaigns');
        if (!$table->hasColumn('data')) {
            $table->addColumn('data', 'text', ['notnull' => false, 'default' => null]);
        }

        return $schema;
    }
}
