// Libraries TavernHelper hands every front-end card as globals ($, _, z, YAML, showdown).
// vite.config.ts bundles this file into one script that is put inside each card in the preview,
// so these work offline and don't depend on a CDN. (Vue, jQuery UI and the rest come from jsDelivr, as in TavernHelper.)
import $ from 'jquery';
import _ from 'lodash';
import * as z from 'zod';
import YAML from 'yaml';
import showdown from 'showdown';

Object.assign(window, { $, jQuery: $, _, z, YAML, showdown });
