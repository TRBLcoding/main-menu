import PocketBase from 'pocketbase';

// Dynamically resolve base URL for Home Assistant Ingress subpaths
const getBasePath = () => {
  let path = window.location.pathname;
  if (path.endsWith('index.html')) {
    path = path.substring(0, path.lastIndexOf('/') + 1);
  }
  if (!path.endsWith('/')) {
    path += '/';
  }
  return path;
};

export const pb = new PocketBase(getBasePath());