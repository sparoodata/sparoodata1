
const mongoose = require("mongoose");

const InstanceSchema = new mongoose.Schema({
  instance_name: { type: String, required: true },
  database_type: { type: String, required: true },
  enable_backups: { type: Boolean, default: false },
  admin_password: { type: String, required: true },
  allow_cidrs: [{ type: String, required: true }],
  organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
  status: { type: String, default: "pending" },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Instance", InstanceSchema);