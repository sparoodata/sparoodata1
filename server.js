// Install required packages: npm install express passport passport-auth0 express-session dotenv

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const Auth0Strategy = require('passport-auth0');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'a_default_secret',
    resave: false,
    saveUninitialized: true,
  })
);

// Configure Passport.js
passport.use(
  new Auth0Strategy(
    {
      domain: process.env.AUTH0_DOMAIN,
      clientID: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      callbackURL: process.env.AUTH0_CALLBACK_URL || 'http://localhost:3000/callback',
    },
    function (accessToken, refreshToken, extraParams, profile, done) {
      return done(null, profile);
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

app.use(passport.initialize());
app.use(passport.session());

// Middleware to check authentication
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

// Routes
app.get('/', (req, res) => {
  res.send('<h1>Welcome to the Auth0 SSO App</h1><a href="/login">Log In</a>');
});

app.get('/login', passport.authenticate('auth0', {
  scope: 'openid email profile',
}));

app.get('/callback', (req, res, next) => {
  passport.authenticate('auth0', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.redirect('/login');
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      res.redirect('/dashboard');
    });
  })(req, res, next);
});

app.get('/dashboard', isAuthenticated, (req, res) => {
  res.send(`<h1>Dashboard</h1><p>Welcome, ${req.user.displayName || req.user.nickname}</p><a href="/logout">Log Out</a>`);
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error(err);
      return res.redirect('/');
    }
    res.redirect(`https://${process.env.AUTH0_DOMAIN}/v2/logout?returnTo=${encodeURIComponent('http://localhost:3000')}&client_id=${process.env.AUTH0_CLIENT_ID}`);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
