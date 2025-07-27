// middleware/isAuthenticated.js
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        // User is authenticated, proceed to the next middleware/route
        next();
    } else {
        // User is NOT authenticated

        // Log for debugging
        console.log('User not authenticated.');

        // Check if it's an AJAX/XHR request (e.g., fetch, XMLHttpRequest)
        // Common ways to detect AJAX:
        // 1. req.xhr (if using jQuery AJAX or explicitly set X-Requested-With header)
        // 2. Checking 'Accept' header for 'application/json' or similar
        const isAjaxRequest = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));

        if (isAjaxRequest) {
            // For AJAX requests, send a 401 Unauthorized status with a JSON error
            console.log('AJAX request: Sending 401 Unauthorized.');
            return res.status(401).json({
                success: false,
                message: 'Non autorisé. Veuillez vous reconnecter.',
                redirectUrl: '/login' // Optionally, tell the client where to redirect
            });
        } else {
            // For regular browser navigations, redirect to the login page
            console.log('Regular browser request: Redirecting to /login');
            req.flash('error', 'Veuillez vous connecter pour accéder à cette page.'); // If you use connect-flash
            return res.redirect('/login');
        }
    }
};

module.exports = isAuthenticated;
