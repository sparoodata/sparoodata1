const mongoose = require("mongoose");

const InstanceSchema = new mongoose.Schema({
  instance_name: String,
  database_type: String,
  enable_backups: Boolean,
  admin_password: String,
  allow_cidrs: [String],
  organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization" },
  project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
  status: String,
  created_by: { type: String, required: true }, // Associate with the user's ID
});

module.exports = mongoose.models.Instance || mongoose.model("Instance", InstanceSchema);
