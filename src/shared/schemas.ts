import { Type } from '@sinclair/typebox';

export const Id = Type.String({ format: 'uuid' });
export const OrganizationParams = Type.Object({ organizationId: Id });
export const EventParams = Type.Object({ organizationId: Id, eventId: Id });
export const ReservationParams = Type.Object({ organizationId: Id, reservationId: Id });
export const PageQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000, default: 0 })),
});
export const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});
export const errors = {
  400: ErrorResponse,
  401: ErrorResponse,
  403: ErrorResponse,
  404: ErrorResponse,
  409: ErrorResponse,
  429: ErrorResponse,
  500: ErrorResponse,
  503: ErrorResponse,
};
export const security = [{ bearerAuth: [] }];
