// Hand-authored OpenAPI 3.0 spec for the machine-to-machine partner API
// (/partner-api/v1). Served as raw JSON + Swagger UI. Keep in sync with the
// routes/validators when the contract changes.

export const partnerOpenApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Imcorpcart Partner API',
    version: '1.0.0',
    description:
      'The **Imcorpcart Partner API** lets approved integration partners browse their catalogue, ' +
      'check delivery serviceability, and place, read, and cancel orders — machine-to-machine.\n\n' +
      '**Authentication.** Every request carries a single bearer token issued to you:\n\n' +
      '```\nAuthorization: Bearer <your-token>\n```\n\n' +
      'All traffic is over HTTPS. Prices shown are *your* price (basis + commission); catalogue is a ' +
      'snapshot, so availability and price are re-validated at order time with structured error codes. ' +
      'Order status updates are pushed to your webhook — this reference is read-only.',
  },
  servers: [
    { url: 'https://imcorp.heptanesia.com/partner-api/v1', description: 'Production' },
    { url: 'http://localhost:4000/partner-api/v1', description: 'Local dev' },
  ],
  tags: [
    { name: 'Catalogue', description: 'Products enabled for you, at your configured price' },
    { name: 'Delivery', description: 'Serviceability + delivery ETA' },
    { name: 'Orders', description: 'Place, read, and cancel orders' },
    { name: 'System', description: 'Health' },
  ],
  paths: {
    '/ping': {
      get: {
        tags: ['System'],
        summary: 'Auth smoke test',
        responses: {
          200: { description: 'OK', content: { 'application/json': { example: { ok: true, partner: 'GenieMart' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/catalogue': {
      get: {
        tags: ['Catalogue'],
        summary: 'List your catalogue (paginated snapshot)',
        description: 'Only products imcorpcart has enabled for you. `price` is your price (basis + commission). Not live inventory — validate at order time.',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
          { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Category slug filter' },
        ],
        responses: {
          200: {
            description: 'A page of catalogue products',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/CatalogueProduct' } },
                    meta: { $ref: '#/components/schemas/PageMeta' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/catalogue/{sku}': {
      get: {
        tags: ['Catalogue'],
        summary: 'Get one catalogue product',
        parameters: [{ name: 'sku', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Product', content: { 'application/json': { schema: { $ref: '#/components/schemas/CatalogueProduct' } } } },
          404: { $ref: '#/components/responses/NotFound' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/delivery': {
      get: {
        tags: ['Delivery'],
        summary: 'Delivery ETA (optionally per item)',
        parameters: [
          { name: 'pincode', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{6}$' } },
          { name: 'sku', in: 'query', schema: { type: 'string' }, description: 'When given, `available` reflects this item’s stock' },
        ],
        responses: {
          200: {
            description: 'Delivery estimate',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DeliveryEstimate' },
                example: { pincode: '400001', sku: 'GP-AN-1000', serviceable: true, available: true, tentativeDeliveryDays: 3, dispatchDays: 1, courier: 'Bluedart', etaDate: '2026-09-06T00:00:00.000Z' },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/orders': {
      post: {
        tags: ['Orders'],
        summary: 'Place an order',
        description:
          'We validate each line against your catalogue price, availability, and pincode serviceability. ' +
          '`externalRef` is your order id and the dedup key — re-posting the same value returns the existing order (200, `duplicate:true`) instead of creating another.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptOrder' } } } },
        responses: {
          201: { description: 'Accepted (created)', content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderAccepted' } } } },
          200: { description: 'Accepted (duplicate — already existed)', content: { 'application/json': { example: { status: 'ACCEPTED', orderNo: 'IMC-44469003', checkoutGroup: 'abc123', duplicate: true } } } },
          422: { description: 'Rejected — nothing created', content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderRejected' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/orders/{ref}': {
      get: {
        tags: ['Orders'],
        summary: 'Read an order by our orderNo or your externalRef',
        parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Order (split orders share one externalRef)', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/OrderDetail' } } } } } } },
          404: { $ref: '#/components/responses/NotFound' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/orders/{ref}/cancel': {
      post: {
        tags: ['Orders'],
        summary: 'Cancel an order',
        description: 'Cancels the whole order (all split orders in the checkout group). Only orders that are not yet dispatched can be cancelled.',
        parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } },
        responses: {
          200: { description: 'Cancelled', content: { 'application/json': { example: { status: 'CANCELLED', orderNo: 'IMC-44469003', orderNos: ['IMC-44469003'] } } } },
          422: { description: 'Not cancellable (already dispatched/delivered)', content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderRejected' } } } },
          404: { $ref: '#/components/responses/NotFound' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
  },
  components: {
    responses: {
      Unauthorized: { description: 'Missing/invalid token, disabled partner, or IP not allowed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      NotFound: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
    schemas: {
      PageMeta: {
        type: 'object',
        properties: { total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' }, pageCount: { type: 'integer' } },
      },
      CatalogueProduct: {
        type: 'object',
        properties: {
          sku: { type: 'string' },
          name: { type: 'string' },
          brand: { type: 'string', nullable: true },
          category: { type: 'string' },
          subCategory: { type: 'string' },
          price: { type: 'number', description: 'Your price = base(basis) × (1 + commission%)' },
          discountPercent: { type: 'integer', description: 'MRP vs your price' },
          priceBasis: { type: 'string', enum: ['MRP', 'MOP', 'EPP'] },
          commissionPct: { type: 'number' },
          mrp: { type: 'number' },
          gstPercent: { type: 'number', nullable: true },
          hsnCode: { type: 'string', nullable: true },
          stock: { type: 'integer' },
          description: { type: 'string', nullable: true },
          images: { type: 'array', items: { type: 'string' } },
          warrantyText: { type: 'string', nullable: true },
          termsText: { type: 'string', nullable: true },
          freebie: { type: 'string', nullable: true },
        },
      },
      DeliveryEstimate: {
        type: 'object',
        properties: {
          pincode: { type: 'string' },
          sku: { type: 'string', nullable: true },
          serviceable: { type: 'boolean' },
          available: { type: 'boolean', nullable: true, description: 'null when no sku is given' },
          tentativeDeliveryDays: { type: 'integer', nullable: true },
          dispatchDays: { type: 'integer' },
          courier: { type: 'string', nullable: true },
          etaDate: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      AcceptOrder: {
        type: 'object',
        required: ['externalRef', 'items', 'shipping'],
        properties: {
          externalRef: { type: 'string', description: 'Your order id (dedup key)' },
          dealerCode: { type: 'string' },
          dealerName: { type: 'string' },
          dealerMobile: { type: 'string' },
          deliveryInstructions: { type: 'string' },
          items: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['sku', 'qty'],
              properties: { sku: { type: 'string' }, qty: { type: 'integer', minimum: 1 }, price: { type: 'number', description: 'Optional — validated to your catalogue price (±₹1)' } },
            },
          },
          shipping: {
            type: 'object',
            required: ['name', 'phone', 'line1', 'city', 'state', 'pincode'],
            properties: {
              name: { type: 'string' }, phone: { type: 'string' }, line1: { type: 'string' }, line2: { type: 'string' },
              city: { type: 'string' }, state: { type: 'string' }, pincode: { type: 'string', pattern: '^\\d{6}$' },
            },
          },
        },
        example: {
          externalRef: 'GM-9921',
          dealerCode: 'HK-4471',
          dealerName: 'Sharma Mobiles',
          dealerMobile: '9812345678',
          deliveryInstructions: 'Call before delivery',
          items: [{ sku: 'GP-AN-1000', qty: 1, price: 3299 }],
          shipping: { name: 'Rahul', phone: '9812345678', line1: '12 MG Road', city: 'Mumbai', state: 'MH', pincode: '400001' },
        },
      },
      OrderAccepted: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ACCEPTED' },
          orderNo: { type: 'string' },
          checkoutGroup: { type: 'string' },
          orderCount: { type: 'integer' },
          orderNos: { type: 'array', items: { type: 'string' } },
        },
      },
      OrderRejected: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'REJECTED' },
          reasons: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['NOT_IN_CATALOGUE', 'OUT_OF_STOCK', 'PRICE_MISMATCH', 'PINCODE_UNSERVICEABLE', 'NOT_CANCELLABLE'] },
                sku: { type: 'string' },
                orderNo: { type: 'string' },
                message: { type: 'string' },
                expected: { type: 'number' },
                got: { type: 'number' },
              },
            },
          },
        },
        example: { status: 'REJECTED', reasons: [{ code: 'PRICE_MISMATCH', sku: 'GP-AN-1000', message: 'Price mismatch for GP-AN-1000', expected: 3299, got: 2999 }] },
      },
      OrderDetail: {
        type: 'object',
        properties: {
          orderNo: { type: 'string' },
          externalRef: { type: 'string', nullable: true },
          status: { type: 'string' },
          checkoutGroup: { type: 'string', nullable: true },
          dealerCode: { type: 'string', nullable: true },
          dealerName: { type: 'string', nullable: true },
          dealerMobile: { type: 'string', nullable: true },
          deliveryInstructions: { type: 'string', nullable: true },
          cancelReason: { type: 'string', nullable: true },
          subtotal: { type: 'number' },
          total: { type: 'number' },
          createdAt: { type: 'string', format: 'date-time' },
          items: {
            type: 'array',
            items: { type: 'object', properties: { sku: { type: 'string' }, name: { type: 'string' }, quantity: { type: 'integer' }, unitPrice: { type: 'number' }, lineTotal: { type: 'number' } } },
          },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } },
      },
    },
  },
} as const;
