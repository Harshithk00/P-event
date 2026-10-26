function requireLogin(req, res, next) {
  if (req.user) return next();
  req.session.flash = { type: 'error', message: 'Please log in to continue.' };
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (roles.includes(req.user.role)) return next();
    res.status(403).render('error', { title: 'Forbidden', message: 'You do not have permission to view this page.' });
  };
}

// Organizers may only manage their own events; admins may manage any.
function canManage(user, event) {
  return !!user && !!event && (user.role === 'admin' || (user.role === 'organizer' && event.organizer_id === user.id));
}

module.exports = { requireLogin, requireRole, canManage };
