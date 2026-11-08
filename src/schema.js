'use strict';
const { z } = require('zod');
const { HOUSE_CODES } = require('./ephemeris');

const chartRequest = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM (24h)').nullable().optional(),
  unknown_time: z.boolean().optional().default(false),
  zone: z.string().min(1).max(64).nullable().optional(),
  utc_offset_minutes: z.number().int().min(-14 * 60).max(14 * 60).nullable().optional(),
  disambiguation: z.enum(['earlier', 'later']).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  place: z.string().max(200).optional(),
  city_id: z.union([z.number().int(), z.string().max(40)]).optional(),
  house_system: z.enum(Object.keys(HOUSE_CODES)).optional(),
  node: z.enum(['true', 'mean']).optional(),
  lilith: z.enum(['mean', 'true']).optional(),
  fortune: z.enum(['day_night', 'day']).optional(),
  rulership: z.enum(['modern', 'traditional']).optional(),
  include_minor_aspects: z.boolean().optional(),
  include_asteroids: z.boolean().optional(),
}).strict().superRefine((v, ctx) => {
  const [y, m, d] = v.date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) ctx.addIssue({ code: 'custom', path: ['date'], message: 'date is not a real calendar date' });
  if (y < 1800 || y > 2399) ctx.addIssue({ code: 'custom', path: ['date'], message: 'date must be between 1800 and 2399 (ephemeris range)' });
  if (v.time) { const [hh, mm] = v.time.split(':').map(Number); if (hh > 23 || mm > 59) ctx.addIssue({ code: 'custom', path: ['time'], message: 'time out of range' }); }
  if (!v.unknown_time && !v.time) ctx.addIssue({ code: 'custom', path: ['time'], message: 'time is required unless unknown_time is true' });
  if (!v.zone && !Number.isFinite(v.utc_offset_minutes)) ctx.addIssue({ code: 'custom', path: ['zone'], message: 'zone (IANA) or utc_offset_minutes is required' });
});

module.exports = { chartRequest };
