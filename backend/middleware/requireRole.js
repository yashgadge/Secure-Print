function requireRole(...roles) {
  return (req, res, next) => {
    const sess = req.session;
    if (!sess || !sess.userId || !sess.role) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (roles.length && !roles.includes(sess.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = requireRole;
