<?php
/**
 * auth.php — Session Authentication Helper
 *
 * Include this at the top of any page that requires authentication:
 *   require_once __DIR__ . '/auth.php';
 *   require_auth();
 *
 * This file handles:
 *   - Starting the session with secure settings
 *   - Checking if the user is authenticated
 *   - Enforcing idle timeout
 *   - Redirecting to login if not authenticated
 */

require_once __DIR__ . '/config.php';

// ── Start session securely ────────────────────────────────────────
function start_secure_session() {
    if (session_status() === PHP_SESSION_NONE) {
        session_name(SESSION_NAME);
        session_set_cookie_params([
            'lifetime' => 0,           // cookie expires when browser closes
            'path'     => '/',
            'secure'   => isset($_SERVER['HTTPS']),  // HTTPS-only if available
            'httponly' => true,         // not accessible via JavaScript
            'samesite' => 'Strict',     // CSRF protection
        ]);
        session_start();
    }
}

// ── Check authentication, redirect to login if not ───────────────
function require_auth() {
    start_secure_session();

    // Check idle timeout
    if (isset($_SESSION['auth']) && $_SESSION['auth'] === true) {
        $last = $_SESSION['last_activity'] ?? 0;
        if (time() - $last > SESSION_TIMEOUT) {
            // Session expired — destroy and redirect
            session_unset();
            session_destroy();
            header('Location: editor-login.php?timeout=1');
            exit;
        }
        // Refresh last activity timestamp
        $_SESSION['last_activity'] = time();
        return;   // ✓ authenticated
    }

    // Not authenticated — redirect to login
    // Preserve the intended destination so we can redirect back after login
    $redirect = urlencode($_SERVER['REQUEST_URI']);
    header('Location: editor-login.php?redirect=' . $redirect);
    exit;
}

// ── Login: verify password and create session ────────────────────
function do_login(string $password): bool {
    start_secure_session();

    if (password_verify($password, EDITOR_PASSWORD_HASH)) {
        // Regenerate session ID on login — prevents session fixation attacks
        session_regenerate_id(true);
        $_SESSION['auth']          = true;
        $_SESSION['last_activity'] = time();
        return true;
    }
    return false;
}

// ── Logout: destroy session completely ───────────────────────────
function do_logout() {
    start_secure_session();
    session_unset();
    session_destroy();
    // Clear the session cookie
    setcookie(session_name(), '', time() - 3600, '/');
}

// ── Check if currently logged in (non-redirecting) ───────────────
function is_authenticated(): bool {
    start_secure_session();
    return isset($_SESSION['auth']) && $_SESSION['auth'] === true;
}
