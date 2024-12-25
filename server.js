/************************************
 * server.js — Security-Hardened Example
 ************************************/
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const Auth0Strategy = require("passport-auth0");
const path = require("path");
const nocache = require("nocache");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const Joi = require("joi"); // For input validation
require("dotenv").config();

// Models
const Organization = require("./models/organization");
const Project = require("./models/project");
const InstanceModel = require("./models/instance");

// Initialize Express
const app = express();
app.use(nocache());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Session config
//app.use(
//  session({
  //  secret: process.env.SESSION_SECRET || "your-secret-key",
  //  resave: false,
   // saveUninitialized: false,
    //cookie: {
     // secure: true,
    //  secure: process.env.NODE_ENV === "production", // only set true if behind HTTPS
     // httpOnly: true,    // prevents JS access to cookies
   //   sameSite: "strict" // helps mitigate CSRF
//    }
//  })
//);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);
// Connect Mongoose
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sparoodata", {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Passport Auth0
passport.use(
  new Auth0Strategy(
    {
      domain: process.env.AUTH0_DOMAIN,
      clientID: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      callbackURL:
        process.env.AUTH0_CALLBACK_URL || "http://localhost:3000/callback"
    },
    (accessToken, refreshToken, extraParams, profile, done) => {
      return done(null, profile);
    }
  )
);
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.use(passport.initialize());
app.use(passport.session());

// Auth middleware
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.redirect("/login");
}

// If you trust the first proxy (e.g., on Heroku/Glitch):
app.set('trust proxy', 1);

// or if you trust multiple proxies:
app.set('trust proxy', true);

// ---------------------
// Rate Limiting
// ---------------------
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                 // limit each IP to 100 requests per window
  message: {
    error: "Too many requests, please try again later."
  }
});

// ---------------------
// JOI Schemas
// ---------------------
const organizationSchema = Joi.object({
  org_name: Joi.string().min(3).max(100).required(),
  location: Joi.string().min(2).max(100).required()
});

const projectSchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  description: Joi.string().allow("").max(300)
});

const instanceSchema = Joi.object({
  instance_name: Joi.string().min(3).max(100).required(),
  database_type: Joi.string().valid("mysql", "mariadb", "mongodb", "postgres").required(),
  enable_backups: Joi.boolean().required(),
  admin_password: Joi.string().min(5).required(),
  allow_cidrs: Joi.string().required(),
  organization: Joi.string().required(),
  project: Joi.string().required()
});

// ---------------------
// Routes
// ---------------------
//app.get("/", (req, res) => {
//  res.send('<h1>Welcome to SparooData</h1><p><a href="/login">Log In</a></p>');
//});

app.get("/", (req, res) => {
  return res.redirect("/login");
});

// Auth0 login
app.get(
  "/login",
  passport.authenticate("auth0", { scope: "openid email profile" })
);

app.get("/callback", (req, res, next) => {
  passport.authenticate("auth0", (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect("/login");
    req.logIn(user, (err) => {
      if (err) return next(err);
      res.redirect("/dashboard");
    });
  })(req, res, next);
});

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.redirect("/");
    const returnTo = "https://fir-mixed-request.glitch.me";
    res.redirect(
      `https://${process.env.AUTH0_DOMAIN}/v2/logout?returnTo=${encodeURIComponent(
        returnTo
      )}&client_id=${process.env.AUTH0_CLIENT_ID}`
    );
  });
});

// Dashboard
app.get("/dashboard", isAuthenticated, async (req, res) => {
  try {
    const organizations = await Organization.find({ created_by: req.user.id });
    // If needed, fetch projects or instances specifically
    const instances = await InstanceModel.find({ created_by: req.user.id });
    res.render("dashboard", {
      user: req.user,
      organizations,
      instances
    });
  } catch (err) {
    console.error("Error loading dashboard:", err);
    res.status(500).send("Error loading dashboard.");
  }
});

// ---------------------
// 1) GET /organizations
// ---------------------
app.get("/organizations", isAuthenticated, async (req, res) => {
  try {
    const organizations = await Organization.find({ created_by: req.user.id });
    res.json(organizations);
  } catch (err) {
    console.error("Error fetching organizations:", err);
    res.status(500).json({ error: "Error fetching organizations" });
  }
});

// ---------------------
// 2) GET /organization/:orgId/projects
// ---------------------
app.get("/organization/:orgId/projects", isAuthenticated, async (req, res) => {
  const { orgId } = req.params;
  try {
    const org = await Organization.findOne({
      _id: orgId,
      created_by: req.user.id
    });
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }
    const projects = await Project.find({
      organization: orgId,
      created_by: req.user.id
    });
    res.json(projects);
  } catch (err) {
    console.error("Error fetching projects:", err);
    res.status(500).json({ error: "Error fetching projects" });
  }
});

// ---------------------
// 3) POST /create-organization
//     => uses createLimiter, isAuthenticated, JOI
// ---------------------
app.post("/create-organization", isAuthenticated, createLimiter, async (req, res) => {
  // Validate input
  const { error, value } = organizationSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  const { org_name, location } = value;

  try {
    const newOrg = new Organization({
      org_name,
      location,
      created_by: req.user.id
    });
    await newOrg.save();
    res.json({ success: true, message: "Organization created successfully." });
  } catch (err) {
    console.error("Error creating organization:", err);
    res.status(500).json({ error: "Error creating organization" });
  }
});

// ---------------------
// 4) POST /organization/:orgId/create-project
// ---------------------
app.post("/organization/:orgId/create-project", isAuthenticated, createLimiter, async (req, res) => {
  const { orgId } = req.params;
  const { error, value } = projectSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  const { name, description } = value;

  try {
    // ownership check
    const org = await Organization.findOne({
      _id: orgId,
      created_by: req.user.id
    });
    if (!org) {
      return res.status(404).json({ error: "Organization not found or unauthorized" });
    }

    const newProject = new Project({
      name,
      description,
      organization: orgId,
      created_by: req.user.id // if your schema has a created_by
    });
    await newProject.save();
    res.json({ success: true, message: "Project created successfully." });
  } catch (err) {
    console.error("Error creating project:", err);
    res.status(500).json({ error: "Error creating project" });
  }
});

// ---------------------
// 5) GET /project/:projectId/instances
// ---------------------
app.get("/project/:projectId/instances", isAuthenticated, async (req, res) => {
  const { projectId } = req.params;
  try {
    // optional ownership check
    // const project = await Project.findOne({ _id: projectId, created_by: req.user.id });
    // if (!project) return res.status(403).json({ error: "Not authorized" });

    const instances = await InstanceModel.find({
      project: projectId,
      created_by: req.user.id
    });
    res.json(instances);
  } catch (err) {
    console.error("Error fetching instances:", err);
    res.status(500).json({ error: "Error fetching instances" });
  }
});

// ---------------------
// 6) POST /create-instance
//     => uses rate limiting, JOI, hashed password
// ---------------------
app.post("/create-instance", isAuthenticated, createLimiter, async (req, res) => {
  const { error, value } = instanceSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const {
    instance_name,
    database_type,
    enable_backups,
    admin_password,
    allow_cidrs,
    organization,
    project
  } = value;

  try {
    // Confirm user owns org & project if you want strict ownership checks
    // For now, just hash the password

    const hashedPassword = await bcrypt.hash(admin_password, 10);

    const newInstance = new InstanceModel({
      instance_name,
      database_type,
      enable_backups,
      admin_password: hashedPassword,
      allow_cidrs: allow_cidrs.split(",").map((c) => c.trim()),
      created_by: req.user.id,
      status: "pending",
      organization,
      project
    });
    await newInstance.save();
    res.json({ success: true, message: "Instance created successfully." });
  } catch (err) {
    console.error("Error creating instance:", err);
    res.status(500).json({ error: "Error creating instance" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
