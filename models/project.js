const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  name: String,
  description: String,
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  created_by: { type: String, required: true }, // <-- Add this
});

module.exports = mongoose.models.Project || mongoose.model('Project', ProjectSchema);
