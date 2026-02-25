'use strict';

const { z } = require('zod');

function normalizeClockTime(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const match24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (match24) {
    const hour = String(match24[1] || '').padStart(2, '0');
    const minute = String(match24[2] || '').padStart(2, '0');
    return `${hour}:${minute}`;
  }

  const match12 = raw.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*([AaPp][Mm])$/);
  if (match12) {
    const sourceHour = Number(match12[1]);
    const minute = String(match12[2] || '').padStart(2, '0');
    const period = String(match12[3] || '').toUpperCase();
    if (!Number.isFinite(sourceHour) || sourceHour < 1 || sourceHour > 12) return raw;
    let hour = sourceHour % 12;
    if (period === 'PM') hour += 12;
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }

  return raw;
}

const nullableClockTimeSchema = z.preprocess(
  normalizeClockTime,
  z.union([z.null(), z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/)])
);

const quickMessageShortcutSchema = z.preprocess(
  (value) => {
    if (value == null) return null;
    const normalized = String(value).trim();
    return normalized || null;
  },
  z.union([
    z.null(),
    z.string().regex(/^[a-zA-Z0-9_-]{1,24}$/, 'Atalho invalido. Use apenas letras, numeros, _ ou -'),
  ])
);

// Schema para login
const loginSchema = z.object({
  username: z.string().min(1, 'Usuário é obrigatório').max(100),
  password: z.string().min(1, 'Senha é obrigatória').max(200),
});

// Schema para criação de admin
const setupAdminSchema = z.object({
  username: z.string().min(3, 'Usuário deve ter no mínimo 3 caracteres').max(100),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres').max(200),
});

// Schema para criação/edição de vendedor
const sellerSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(100),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres').max(200).optional(),
  active: z.boolean().optional(),
});

// Schema para envio de mensagem
const sendMessageSchema = z.object({
  message: z.string().min(1, 'Mensagem é obrigatória').max(10000),
  reply_to_id: z.union([z.number().int().positive(), z.string().transform(v => parseInt(v, 10)).refine(v => !Number.isNaN(v) && v > 0, 'reply_to_id deve ser um número positivo')]).optional(),
});

// Schema para atualização de status de ticket
const ticketStatusSchema = z.object({
  status: z.enum(['pendente', 'aguardando', 'em_atendimento', 'resolvido', 'encerrado']),
});

// Schema para atribuição de ticket
const assignTicketSchema = z.object({
  sellerId: z.union([z.number().int().nonnegative(), z.null()]),
});

// Schema para lembretes (reminders)
const reminderCreateSchema = z.object({
  scheduled_at: z.string().min(5, 'Data/hora é obrigatória'),
  note: z.string().max(1000, 'Observação muito longa').optional().nullable(),
  message: z.string().max(10000, 'Mensagem muito longa').optional().nullable(),
});

const reminderUpdateSchema = z.object({
  scheduled_at: z.string().min(5).optional(),
  note: z.string().max(1000, 'Observação muito longa').optional().nullable(),
  message: z.string().max(10000, 'Mensagem muito longa').optional().nullable(),
  status: z.enum(['scheduled', 'canceled', 'done', 'resolvido']).optional(),
});

const quickMessageCreateSchema = z.object({
  title: z.string().trim().min(1, 'Titulo e obrigatorio').max(120, 'Titulo muito longo'),
  content: z.string().trim().min(1, 'Mensagem e obrigatoria').max(5000, 'Mensagem muito longa'),
  shortcut: quickMessageShortcutSchema.optional(),
});

const quickMessageUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Titulo e obrigatorio').max(120, 'Titulo muito longo').optional(),
  content: z.string().trim().min(1, 'Mensagem e obrigatoria').max(5000, 'Mensagem muito longa').optional(),
  shortcut: quickMessageShortcutSchema.optional(),
}).refine(
  (payload) => Object.prototype.hasOwnProperty.call(payload, 'title')
    || Object.prototype.hasOwnProperty.call(payload, 'content')
    || Object.prototype.hasOwnProperty.call(payload, 'shortcut'),
  'Informe ao menos um campo para atualizar'
);

// Schema para blacklist
const blacklistSchema = z.object({
  phone: z.string().regex(/^[0-9]{10,15}(@s\.whatsapp\.net)?$/, 'Telefone inválido'),
  reason: z.string().max(500).optional(),
});

// Schema para horários de funcionamento
const businessHoursSchema = z.array(
  z.object({
    day: z.number().int().min(0).max(6),
    open_time: nullableClockTimeSchema,
    close_time: nullableClockTimeSchema,
    enabled: z.union([z.boolean(), z.number().int().min(0).max(1)]).transform((value) => Boolean(value)),
  })
);

// Schema para exceção de horário
const businessExceptionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closed: z.union([z.boolean(), z.number().int().min(0).max(1)]).transform((value) => Boolean(value)),
  open_time: nullableClockTimeSchema.optional(),
  close_time: nullableClockTimeSchema.optional(),
  reason: z.string().max(500).nullable().optional(),
});

// Middleware de validação
function validate(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req.body);
      req.body = parsed; // Sanitiza: remove campos extras
      return next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        // ZodError tem a propriedade issues ao invés de errors
        const messages = error.issues && Array.isArray(error.issues) 
          ? error.issues.map((e) => `${e.path.join('.')}: ${e.message}`)
          : error.errors && Array.isArray(error.errors)
          ? error.errors.map((e) => `${e.path.join('.')}: ${e.message}`)
          : ['Erro desconhecido na validação'];
        
        console.error('[validation] Erro de validação:', messages);
        return res.status(400).json({ error: 'Validação falhou', details: messages });
      }
      
      console.error('[validation] Erro ao validar:', error.message);
      return res.status(400).json({ error: 'Dados inválidos: ' + error.message });
    }
  };
}

module.exports = {
  validate,
  schemas: {
    login: loginSchema,
    setupAdmin: setupAdminSchema,
    seller: sellerSchema,
    sendMessage: sendMessageSchema,
    ticketStatus: ticketStatusSchema,
    assignTicket: assignTicketSchema,
    reminderCreate: reminderCreateSchema,
    reminderUpdate: reminderUpdateSchema,
    quickMessageCreate: quickMessageCreateSchema,
    quickMessageUpdate: quickMessageUpdateSchema,
    blacklist: blacklistSchema,
    businessHours: businessHoursSchema,
    businessException: businessExceptionSchema,
  },
};
