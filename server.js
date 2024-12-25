const express = require("express");
const session = require("express-session");
const passport = require("passport");
const Auth0Strategy = require("passport-auth0");
const path = require("path");
const nocache = require("nocache");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");       // <-- New
const bcrypt = require("bcrypt");                      // <-- New
const Joi = require("joi");                            // <-- New

// Your models
const Organization = require("./models/organization");
const Project = require("./models/project");
const InstanceModel = require("./models/instance");

// Load environment variables
require("dotenv").config();

// Initialize Express app
const app = express();
app.use(nocache());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Set view engine to EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// --- SESSION COOKIE SECURITY ---
// Use secure cookies and httpOnly in production
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production", // only transmit over HTTPS in production
      httpOnly: true,                                // not accessible via JavaScript
      sameSite: "strict",                             // helps prevent CSRF
    },
  })
);

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI, {
    // e.g. "mongodb+srv://username:password@cluster.example.mongodb.net/dbname"
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Configure Passport.js with Auth0
passport.use(
  new Auth0Strategy(
    {
      domain: process.env.AUTH0_DOMAIN,
      clientID: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      callbackURL: process.env.AUTH0_CALLBACK_URL,
    },
    (accessToken, refreshToken, extraParams, profile, done) => {
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
  res.redirect("/login");
}

// ---------------------
// RATE LIMITING EXAMPLE
// ---------------------
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                 // limit each IP to 100 requests per window
  message: "Too many requests from this IP, please try again later.",
});


// ---------------------
// ROUTES
// ---------------------
app.get("/", (req, res) => {
  res.send('<h1>Welcome to SparooData</h1><p><a href="/login">Log In</a></p>');
});

app.get("/login", passport.authenticate("auth0", { scope: "openid email profile" }));

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
    // Hard-code your real return URL here or use an env variable
    const returnTo = encodeURIComponent("https://fir-mixed-request.glitch.me");
    res.redirect(`https://${process.env.AUTH0_DOMAIN}/v2/logout?returnTo=${returnTo}&client_id=${process.env.AUTH0_CLIENT_ID}`);
    
  });
});

// Dashboard route
app.get("/dashboard", isAuthenticated, async (req, res) => {
  try {
    const organizations = await Organization.find({ created_by: req.user.id });
    // Possibly fetch projects or populate them to show in the dashboard
    const instances = await InstanceModel.find({ created_by: req.user.id });
    
    res.render("dashboard", {
      user: req.user,
      organizations,
      instances,
    });
  } catch (err) {
    console.error("Error loading dashboard:", err);
    res.status(500).send("Error loading dashboard.");
  }
});

// ------------------------------------
// SECURELY CREATE ORGANIZATION (EXAMPLE)
// ------------------------------------
app.post("/create-organization", isAuthenticated, createLimiter, async (req, res) => {
  const { org_name, location } = req.body;

  // Minimal input validation
  if (!org_name || !location) {
    return res.status(400).json({ error: "Organization name and location required." });
  }

  try {
    const newOrg = new Organization({
      org_name,
      location,
      created_by: req.user.id,
    });
    await newOrg.save();
    return res.json({ success: true, message: "Organization created successfully." });
  } catch (err) {
    console.error("Error creating organization:", err);
    res.status(500).json({ error: "Error creating organization" });
  }
});

// ------------------------------------
// CREATE PROJECT, CHECK ORGANIZATION
// ------------------------------------
app.post("/organization/:orgId/create-project", isAuthenticated, createLimiter, async (req, res) => {
  const { orgId } = req.params;
  const { name, description } = req.body;

  // Validate the organization belongs to this user
  const orgDoc = await Organization.findOne({ _id: orgId, created_by: req.user.id });
  if (!orgDoc) {
    return res.status(403).json({ error: "Organization not found or not owned by user." });
  }

  if (!name) {
    return res.status(400).json({ error: "Project name is required." });
  }

  try {
    const newProject = new Project({
      name,
      description,
      organization: orgDoc._id,
      created_by: req.user.id,
    });
    await newProject.save();

    return res.json({ success: true, message: "Project created successfully." });
  } catch (err) {
    console.error("Error creating project:", err);
    return res.status(500).json({ error: "Error creating project" });
  }
});

// ------------------------------------
// CREATE INSTANCE (HASHING + OWNERSHIP)
// ------------------------------------

// Using Joi for more robust validation
const instanceSchema = Joi.object({
  instance_name: Joi.string().min(3).max(50).required(),
  database_type: Joi.string()
    .valid("mysql", "mariadb", "mongodb", "postgres")
    .required(),
  enable_backups: Joi.boolean().required(),
  admin_password: Joi.string().min(5).required(),
  allow_cidrs: Joi.string().required(), // Could parse further if needed
  project: Joi.string().required(),
});

app.post("/create-instance", isAuthenticated, createLimiter, async (req, res) => {
  // 1) Validate input
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
    project,
  } = value;

  try {
    // 2) Verify user owns the project
    const projectDoc = await Project.findOne({ _id: project, created_by: req.user.id });
    if (!projectDoc) {
      return res.status(403).json({ error: "Unauthorized to create instance in this project." });
    }

    // 3) Hash the admin password (rather than storing in plaintext!)
    const hashedPassword = await bcrypt.hash(admin_password, 10);

    // 4) Create the instance
    const newInstance = new InstanceModel({
      instance_name,
      database_type,
      enable_backups,
      admin_password: hashedPassword, // now stored securely
      allow_cidrs: allow_cidrs.split(",").map((cidr) => cidr.trim()),
      created_by: req.user.id,
      project: projectDoc._id,
      status: "pending",
    });
    await newInstance.save();

    // Optional: link instance in projectDoc.instances if you populate
    // projectDoc.instances.push(newInstance._id);
    // await projectDoc.save();

    return res.json({ success: true, message: "Instance created successfully." });
  } catch (err) {
    console.error("Error creating instance:", err);
    res.status(500).json({ error: "Error creating instance" });
  }
});

// Fetch instances for a specific project (example)
app.get("/project/:projectId/instances", isAuthenticated, async (req, res) => {
  const { projectId } = req.params;

  // Check ownership
  const projectDoc = await Project.findOne({ _id: projectId, created_by: req.user.id });
  if (!projectDoc) {
    return res.status(403).json({ error: "Project not found or not owned by user." });
  }

  try {
    const instances = await InstanceModel.find({
      project: projectId,
      created_by: req.user.id,
    });
    res.json(instances);
  } catch (err) {
    console.error("Error fetching instances:", err);
    res.status(500).json({ error: "Error fetching instances" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
