const mongoose = require('mongoose');

const OrganizationSchema = new mongoose.Schema({
  org_name: String,
  location: String,
  created_by: String,
});

module.exports = mongoose.models.Organization || mongoose.model('Organization', OrganizationSchema);
