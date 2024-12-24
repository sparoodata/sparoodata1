// Import required modules
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const Auth0Strategy = require("passport-auth0");
const path = require("path");
const nocache = require('nocache');
const mongoose = require("mongoose");
const Organization = require("./models/organization");
const Project = require("./models/project");
const InstanceModel = require("./models/instance");
const k8s = require('@kubernetes/client-node');
const fs = require('fs');
// Load environment variables from .env
require('dotenv').config();
// Initialize Express app
const app = express();
app.use(nocache());
// Middleware to parse JSON requests
app.use(express.json());
app.use(express.static("public"));
app.set("view engine", "ejs");

// Configure session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

// MongoDB connection

mongoose
  .connect("mongodb+srv://sparoodata:sparoodata@sparrodata.fchyf.mongodb.net/sparoodata?retryWrites=true&w=majority")
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));



// Configure Passport.js with Auth0
passport.use(
  new Auth0Strategy(
    {
      domain: process.env.AUTH0_DOMAIN,
      clientID: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      callbackURL: process.env.AUTH0_CALLBACK_URL || "http://localhost:3000/callback",
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

// Routes
app.get("/", (req, res) => {
  res.send('<h1>Welcome to SparooData</h1><p><a href="/login">Log In</a></p>');
});

app.get(
  "/login",
  passport.authenticate("auth0", {
    scope: "openid email profile",
  })
);

app.get("/callback", (req, res, next) => {
  passport.authenticate("auth0", (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.redirect("/login");
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      res.redirect("/dashboard");
    });
  })(req, res, next);
});

app.get("/dashboard", isAuthenticated, async (req, res) => {
  try {
    // Fetch instances created by the logged-in user
    const instances = await InstanceModel.find({ created_by: req.user.id, database_type: "mariadb" });
    res.render("dashboard", { user: req.user, instances });
  } catch (err) {
    console.error("Error fetching instances:", err);
    res.status(500).send("Error loading dashboard.");
  }
});



app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error(err);
      return res.redirect("/");
    }
    res.redirect(
      `https://${process.env.AUTH0_DOMAIN}/v2/logout?returnTo=${encodeURIComponent("https://fir-mixed-request.glitch.me")}&client_id=${process.env.AUTH0_CLIENT_ID}`
    );
  });
});

// Fetch all organizations for the logged-in user
app.get("/organizations", isAuthenticated, async (req, res) => {
  try {
    const organizations = await Organization.find({ created_by: req.user.id });
    res.json(organizations);
  } catch (err) {
    res.status(500).json({ error: "Error fetching organizations" });
  }
});

// Fetch projects for a specific organization
app.get(
  "/organization/:orgId/projects",
  isAuthenticated,
  async (req, res) => {
    const { orgId } = req.params;

    try {
      const projects = await Project.find({ organization: orgId });
      res.json(projects.length ? projects : []);
    } catch (err) {
      console.error("Error fetching projects:", err);
      res.status(500).json({ error: "Error fetching projects" });
    }
  }
);

// Route to handle creating a new organization
app.post("/create-organization", isAuthenticated, async (req, res) => {
  const { org_name, location } = req.body;

  try {
    const newOrg = new Organization({
      org_name,
      location,
      created_by: req.user.id,
    });

    await newOrg.save();
    res.json({ success: true, message: "Organization created" });
  } catch (err) {
    console.error("Error creating organization:", err);
    res.status(500).json({ error: "Error creating organization" });
  }
});

// Route to handle creating a new project
app.post(
  "/organization/:orgId/create-project",
  isAuthenticated,
  async (req, res) => {
    const { orgId } = req.params;
    const { name, description } = req.body;

    try {
      const organization = await Organization.findOne({
        _id: orgId,
        created_by: req.user.id,
      });
      if (!organization) {
        return res
          .status(404)
          .json({ error: "Organization not found or you are not authorized" });
      }

      const newProject = new Project({
        name,
        description,
        organization: orgId,
      });

      await newProject.save();
      res.json({ success: true, message: "Project created successfully" });
    } catch (err) {
      console.error("Error creating project:", err);
      res.status(500).json({ error: err.message || "Error creating project" });
    }
  }
);

app.get("/project/:projectId/instances", isAuthenticated, async (req, res) => {
  const { projectId } = req.params;

  try {
    // Fetch instances belonging to the user for the specified project
    const instances = await InstanceModel.find({
      project: projectId,
      created_by: req.user.id, // Restrict to the logged-in user's data
    });

    res.json(instances.length ? instances : []);
  } catch (err) {
    console.error("Error fetching instances:", err);
    res.status(500).json({ error: "Error fetching instances" });
  }
});


app.post("/create-instance", isAuthenticated, async (req, res) => {
  const {
    instance_name,
    database_type,
    enable_backups,
    admin_password,
    allow_cidrs,
    organization,
    project,
  } = req.body;

  try {
    // Ensure the organization belongs to the user
    const org = await Organization.findOne({ _id: organization, created_by: req.user.id });
    if (!org) {
      return res.status(404).json({ error: "Organization not found or not authorized." });
    }

    // Ensure the project belongs to the organization
    const proj = await Project.findOne({ _id: project, organization: organization });
    if (!proj) {
      return res.status(404).json({ error: "Project not found or not authorized." });
    }

    // Create the instance and link it to the user
    const newInstance = new InstanceModel({
      instance_name,
      database_type,
      enable_backups,
      admin_password, // Hash this password in production
      allow_cidrs: allow_cidrs.split(",").map((cidr) => cidr.trim()), // Convert to array
      organization,
      project,
      status: "pending",
      created_by: req.user.id, // Associate with the user
    });

    await newInstance.save();
    res.json({ success: true, message: "Instance created successfully." });
  } catch (err) {
    console.error("Error creating instance:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});


app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
