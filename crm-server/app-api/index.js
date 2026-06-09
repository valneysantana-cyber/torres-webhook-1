'use strict';

/**
 * app-api/index.js — Router do aplicativo móvel (Sprint 0).
 *
 * Monta, sob o prefixo /app/v1, a API autenticada por JWT + papéis usada
 * pelo app de Operação & Vistorias (iOS/Android via Capacitor).
 *
 * Uso no crm-server/index.js (ANTES do gate de x-api-key):
 *     const { createAppApi } = require('./app-api');
 *     app.use('/app/v1', createAppApi(db));     // depois que `db` conectar
 *
 * Autenticação é própria (Bearer JWT) — independente da API key do CRM.
 */

const express = require('express');
const auth = require('./auth');
const { mountInspectionRoutes } = require('./inspections');
const { mountOwnerRoutes } = require('./owner');

/** Popula um express.Router() já existente (útil quando o router é registrado
 *  antes do gate de x-api-key, mas o `db` só fica pronto no boot). */
function attachAppApi(router, db) {
  router.use(express.json({ limit: '25mb' })); // fotos em base64

  // health do módulo (sem auth)
  router.get('/health', (_req, res) => res.json({ ok: true, module: 'app-api', ts: new Date() }));

  auth.mountAuthRoutes(router, db);
  mountInspectionRoutes(router, db);
  mountOwnerRoutes(router, db);

  return router;
}

/** Cria um router novo já populado (uso standalone / testes). */
function createAppApi(db) {
  return attachAppApi(express.Router(), db);
}

async function ensureAppIndexes(db) {
  await auth.ensureIndexes(db);
  await require('./inspections').ensureIndexes(db);
}

module.exports = { createAppApi, attachAppApi, ensureAppIndexes };
