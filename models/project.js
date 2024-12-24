const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  name: String,
  description: String,
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  created_by: { type: String, required: true }, // Make sure you're storing the user who created it
  instances: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Instance' }], // <-- Add this
});

module.exports = mongoose.models.Project || mongoose.model('Project', ProjectSchema);
