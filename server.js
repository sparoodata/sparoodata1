const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GitHubStrategy = require("passport-github2").Strategy;
const path = require("path");
const nocache = require('nocache');
const mongoose = require("mongoose");
const Organization = require("./models/organization");
const Project = require("./models/project");
const InstanceModel = require("./models/instance");
const k8s = require('@kubernetes/client-node');
const fs = require('fs');


// Initialize Express app
const app = express();
app.use(nocache());
// Middleware to parse JSON requests
app.use(express.json());
app.use(express.static("public"));

// Configure session middleware
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

// MongoDB connection
mongoose
  .connect(
    "mongodb+srv://sparoodata:sparoodata@sparrodata.fchyf.mongodb.net/sparoodata?retryWrites=true&w=majority",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Initialize Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Passport GitHub strategy configuration
passport.use(
  new GitHubStrategy(
    {
      clientID: "Ov23lilkAuAKEFTXeNkB",
      clientSecret: "8575c0410d95f7666227fd096a22301e24a54d5b",
      callbackURL:
        "https://iron-nasal-appliance.glitch.me/auth/github/callback",
    },
    function (accessToken, refreshToken, profile, done) {
      return done(null, profile);
    }
  )
);

// Serialize user to session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  done(null, { id });
});

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

// Fetch all organizations for the logged-in user
app.get("/organizations", ensureAuthenticated, async (req, res) => {
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
  ensureAuthenticated,
  async (req, res) => {
    const { orgId } = req.params;

    try {
      // Find projects where organization matches orgId
      const projects = await Project.find({ organization: orgId });
      res.json(projects.length ? projects : []); // Return empty array if no projects
    } catch (err) {
      console.error("Error fetching projects:", err);
      res.status(500).json({ error: "Error fetching projects" });
    }
  }
);

// GitHub authentication route
app.get(
  "/auth/github",
  passport.authenticate("github", { scope: ["user:email"] })
);

// GitHub callback route
app.get(
  "/auth/github/callback",
  passport.authenticate("github", { failureRedirect: "/login" }),
  (req, res) => {
    res.redirect("/dashboard");
  }
);

// Route to handle creating a new organization
app.post("/create-organization", ensureAuthenticated, async (req, res) => {
  const { org_name, location } = req.body;

  try {
    const newOrg = new Organization({
      org_name,
      location,
      created_by: req.user.id, // GitHub user ID from session
    });

    await newOrg.save();
    res.json({ success: true, message: "Organization created" });
  } catch (err) {
    console.error("Error creating organization:", err);
    res.status(500).json({ error: "Error creating organization" });
  }
});

// Route to handle creating a new project
// Route to handle creating a new project
app.post(
  "/organization/:orgId/create-project",
  ensureAuthenticated,
  async (req, res) => {
    const { orgId } = req.params;
    const { name, description } = req.body;

    try {
      // Check if the organization exists and was created by the current user
      const organization = await Organization.findOne({
        _id: orgId,
        created_by: req.user.id,
      });
      if (!organization) {
        return res
          .status(404)
          .json({ error: "Organization not found or you are not authorized" });
      }

      // Create a new project for the specified organization
      const newProject = new Project({
        name,
        description,
        organization: orgId, // Link project to the organization
      });

      await newProject.save();
      res.json({ success: true, message: "Project created successfully" });
    } catch (err) {
      console.error("Error creating project:", err);
      res.status(500).json({ error: err.message || "Error creating project" });
    }
  }
);


// Fetch instances for a specific project
app.get(
  "/project/:projectId/instances",
  ensureAuthenticated,
  async (req, res) => {
    const { projectId } = req.params;

    try {
      const instances = await InstanceModel.find({ project: projectId });
      res.json(instances.length ? instances : []); // Return empty array if no instances
    } catch (err) {
      console.error("Error fetching instances:", err);
      res.status(500).json({ error: "Error fetching instances" });
    }
  }
);

// Add this route in your server.js file

// Route to handle creating a new instance
// Route to handle creating a new instance
app.post('/create-instance', ensureAuthenticated, async (req, res) => {
  const {
    instance_name,
    database_type,
    enable_backups,
    admin_password,
    allow_cidrs,
    organization,
    project,
  } = req.body;

  // Basic validation
  if (
    !instance_name ||
    !database_type ||
    !admin_password ||
    !allow_cidrs ||
    !organization ||
    !project
  ) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    // Verify that the organization belongs to the user
    const org = await Organization.findOne({
      _id: organization,
      created_by: req.user.id,
    });
    if (!org) {
      return res
        .status(404)
        .json({ error: 'Organization not found or not authorized.' });
    }

    // Verify that the project belongs to the organization
    const proj = await Project.findOne({
      _id: project,
      organization: organization,
    });
    if (!proj) {
      return res
        .status(404)
        .json({ error: 'Project not found or not authorized.' });
    }

    // Create a new instance in the database
    const newInstance = new InstanceModel({
      instance_name,
      database_type,
      enable_backups,
      admin_password, // Consider hashing the password in a real application
      allow_cidrs: allow_cidrs.split(',').map((cidr) => cidr.trim()), // Convert to array
      organization,
      project,
      status: 'pending', // Default status
    });

    await newInstance.save();

    // If the database type is MariaDB, create it in Kubernetes
    if (database_type.toLowerCase() === 'mariadb') {
      // Load kubeconfig
      const kc = new k8s.KubeConfig();
      kc.loadFromFile('./kubeconfig.yaml');

      const k8sApi = kc.makeApiClient(k8s.CustomObjectsApi);

      // Read and parse the MariaDB YAML template
      let mariadbManifest = fs.readFileSync('./mariadb-template.yaml', 'utf8');

      // Replace placeholders with actual values
      mariadbManifest = mariadbManifest.replace(/{{INSTANCE_NAME}}/g, instance_name);
      mariadbManifest = mariadbManifest.replace(/{{ADMIN_PASSWORD}}/g, admin_password);
      // Add more replacements as needed

console.log('Final MariaDB Manifest:\n', mariadbManifest);

      // Parse the manifest into a JavaScript object
      const mariadbResource = k8s.loadYaml(mariadbManifest);

      // Create the MariaDB instance in Kubernetes
      await k8sApi.createNamespacedCustomObject(
        'k8s.mariadb.com',
        'v1alpha1',
        'default', // Change namespace if needed
        'mariadbs',
        mariadbResource
      );

      // Update instance status in the database
      newInstance.status = 'running';
      await newInstance.save();
    }

    res.json({ success: true, message: 'Instance created successfully.' });
  } catch (err) {
    console.error('Error creating instance:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Serve the dashboard only if authenticated
app.get("/dashboard", ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// Logout route
app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

// Serve the login page
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

// Home route
app.get("/", (req, res) => {
  res.send(
    '<h1>Welcome to SparooData</h1><p><a href="/login">Login with GitHub</a></p>'
  );
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on  port ${PORT}`);
});
