<?php
/**
 * editor-logout.php — Session logout handler
 * Destroys the session and redirects to the login page.
 */
require_once __DIR__ . '/auth.php';
do_logout();
header('Location: editor-login.php');
exit;
