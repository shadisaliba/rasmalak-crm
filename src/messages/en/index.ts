import app from './app';
import common from './common';
import nav from './nav';
import settings from './settings';
import auth from './auth';
import crm from './crm';
import org from './org';
import billing from './billing';
import integrations from './integrations';
import automation from './automation';
import whatsapp from './whatsapp';
import api from './api';
import documents from './documents';
import verticals from './verticals';
import errors from './errors';
import sme from './sme';
import tools from './tools';
import calc from './calc';
import learn from './learn';

// Flatten all domain messages into a single object with prefixed keys
function flatten(obj: Record<string, string>, prefix: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key in obj) {
    result[`${prefix}.${key}`] = obj[key];
  }
  return result;
}

const messages: Record<string, string> = {
  ...flatten(app, 'app'),
  ...flatten(common, 'common'),
  ...flatten(nav, 'nav'),
  ...flatten(settings, 'settings'),
  ...flatten(auth, 'auth'),
  ...flatten(crm, 'crm'),
  ...flatten(org, 'org'),
  ...flatten(billing, 'billing'),
  ...flatten(integrations, 'integrations'),
  ...flatten(automation, 'automation'),
  ...flatten(whatsapp, 'whatsapp'),
  ...flatten(api, 'api'),
  ...flatten(documents, 'documents'),
  ...flatten(verticals, 'verticals'),
  ...flatten(errors, 'errors'),
  ...flatten(sme, 'sme'),
  ...flatten(tools, 'tools'),
  ...flatten(calc, 'calc'),
  ...flatten(learn, 'learn'),
};

export default messages;
