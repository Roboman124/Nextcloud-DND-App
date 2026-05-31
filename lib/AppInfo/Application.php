<?php
declare(strict_types=1);

namespace OCA\Grimoire\AppInfo;

use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;

/**
 * Application bootstrap. Nextcloud autoloads this and calls register()/boot().
 * Most wiring (controllers, mappers) is resolved automatically by the DI
 * container via constructor type hints, so there is little to do here yet.
 */
class Application extends App implements IBootstrap {
    public const APP_ID = 'grimoire';

    public function __construct() {
        parent::__construct(self::APP_ID);
    }

    public function register(IRegistrationContext $context): void {
        // Register event listeners, capabilities, or middleware here as the
        // app grows (e.g. a Capabilities provider advertising the WS relay URL).
    }

    public function boot(IBootContext $context): void {
        // Runtime setup that needs the full server context.
    }
}
