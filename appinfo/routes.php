<?php
declare(strict_types=1);

/**
 * Route table. `page` routes serve the SPA; `api` routes are JSON (OCS-style)
 * used by the Vue frontend and the addon capability bridge.
 */
return [
    'routes' => [
        // SPA entry — also matches deep links so the Vue router can take over.
        ['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
        ['name' => 'page#room', 'url' => '/c/{campaignId}/s/{sceneId}', 'verb' => 'GET',
            'postfix' => 'room'],

        // Campaigns
        ['name' => 'campaign#index', 'url' => '/api/campaigns', 'verb' => 'GET'],
        ['name' => 'campaign#create', 'url' => '/api/campaigns', 'verb' => 'POST'],
        ['name' => 'campaign#show', 'url' => '/api/campaigns/{id}', 'verb' => 'GET'],
        ['name' => 'campaign#update', 'url' => '/api/campaigns/{id}', 'verb' => 'PUT'],
        ['name' => 'campaign#destroy', 'url' => '/api/campaigns/{id}', 'verb' => 'DELETE'],

        // Scenes (belong to a campaign)
        ['name' => 'scene#index', 'url' => '/api/campaigns/{campaignId}/scenes', 'verb' => 'GET'],
        ['name' => 'scene#create', 'url' => '/api/campaigns/{campaignId}/scenes', 'verb' => 'POST'],
        ['name' => 'scene#show', 'url' => '/api/scenes/{id}', 'verb' => 'GET'],
        ['name' => 'scene#update', 'url' => '/api/scenes/{id}', 'verb' => 'PUT'],
        ['name' => 'scene#destroy', 'url' => '/api/scenes/{id}', 'verb' => 'DELETE'],

        // Session management: send email reminders to invited players.
        ['name' => 'session#remind', 'url' => '/api/campaigns/{id}/remind', 'verb' => 'POST'],
        ['name' => 'session#players', 'url' => '/api/campaigns/{id}/players', 'verb' => 'GET'],

        // Discord webhook config (events on/off + write-only webhook URL).
        ['name' => 'campaign#discord', 'url' => '/api/campaigns/{id}/discord', 'verb' => 'PUT'],

        // Player roster management (invite/remove players — GM only).
        ['name' => 'campaign#players', 'url' => '/api/campaigns/{id}/players', 'verb' => 'PUT'],

        // Player permissions (per-layer create/update/delete toggles — GM only).
        ['name' => 'campaign#permissions', 'url' => '/api/campaigns/{id}/permissions', 'verb' => 'PUT'],

        // User search for the invite picker (any logged-in user; not admin-only).
        ['name' => 'user#search', 'url' => '/api/users/search', 'verb' => 'GET'],

        // Same-origin proxy so third-party addon UIs run under a CSP we control.
        ['name' => 'addonProxy#proxy', 'url' => '/addon-proxy', 'verb' => 'GET'],

        // Installed-addon persistence + store catalog.
        ['name' => 'addon#index', 'url' => '/api/addons', 'verb' => 'GET'],
        ['name' => 'addon#install', 'url' => '/api/addons', 'verb' => 'POST'],
        ['name' => 'addon#uninstall', 'url' => '/api/addons/{id}', 'verb' => 'DELETE'],
        ['name' => 'addon#store', 'url' => '/api/addons/store', 'verb' => 'GET'],

        // Asset library: browse Nextcloud Files for maps/tokens/models.
        ['name' => 'asset#index', 'url' => '/api/assets', 'verb' => 'GET'],
        ['name' => 'asset#file', 'url' => '/api/assets/file', 'verb' => 'GET'],
        ['name' => 'asset#thumbnail', 'url' => '/api/assets/thumbnail', 'verb' => 'GET'],

        // Live room: issue a short-lived token for the WS relay; poll fallback.
        ['name' => 'room#token', 'url' => '/api/scenes/{id}/room-token', 'verb' => 'POST'],
        ['name' => 'room#poll', 'url' => '/api/room/poll', 'verb' => 'GET'],
        ['name' => 'room#push', 'url' => '/api/room/push', 'verb' => 'POST'],
    ],
];
