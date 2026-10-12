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
      'check delivery serviceability, place orders, and follow those orders all the way to a signed ' +
      'proof of delivery — machine-to-machine.\n\n' +
      '**Base URL.** `https://imcorp.heptanesia.com/partner-api/v1` — every path below is relative ' +
      'to it.\n\n' +
      '**Authentication.** Every request carries a single bearer token issued to you:\n\n' +
      '```\nAuthorization: Bearer <your-token>\n```\n\n' +
      'All traffic is over HTTPS. Prices shown are *your* price (basis + commission); the catalogue ' +
      'is a snapshot, so availability and price are re-validated at order time with structured error ' +
      'codes. This reference is read-only.\n\n' +
      '## How an integration works\n\n' +
      '1. **Browse** — `GET /catalogue` for what you may sell, `GET /delivery` to check a pincode.\n' +
      '2. **Order** — `POST /orders` with your own `externalRef`. It is the dedup key, so retries ' +
      'are safe.\n' +
      '3. **Follow** — poll `GET /orders?updatedSince=` to see dispatch, every courier scan, and ' +
      'delivery.\n' +
      '4. **Collect the proof** — `GET /orders/{ref}/epod` once an order is delivered.\n\n' +
      '## Following an order\n\n' +
      'There is nothing to subscribe to and no endpoint for you to host: everything we know about ' +
      'your orders is readable here, and you decide how often to look.\n\n' +
      '**Polling recipe.** Call `GET /orders?updatedSince=<the previous response\u2019s ' +
      '`meta.syncedAt`>` and keep the new `syncedAt` for the next call. The window deliberately ' +
      'overlaps — reads are idempotent, so seeing a row twice is harmless and nothing is ever ' +
      'missed. A first sync omits `updatedSince` and pages through everything.\n\n' +
      '`updatedSince` catches every change that matters, including the ones that do not change the ' +
      'order itself: a courier scan (`In Transit` → `Out for Delivery`) and a proof of delivery ' +
      'being attached both bring the order back on your next poll.\n\n' +
      'Nothing expires. An order stays readable, and its proof of delivery stays downloadable, for ' +
      'as long as the order exists — so a gap in your polling costs you nothing.\n\n' +
      '## Order status\n\n' +
      'Every order carries both `statusCode` (stable, switch on this) and `status` (the label, show ' +
      'this). Status reflects the **shipment** where there is one, so In Transit and Out for ' +
      'Delivery are distinct states and not folded into Dispatched.\n\n' +
      '| `statusCode` | `status` | Meaning |\n' +
      '|---|---|---|\n' +
      '| `CONFIRMED` | Confirmed | Accepted, nothing shipped yet |\n' +
      '| `DISPATCHED` | Dispatched | Handed to the courier |\n' +
      '| `IN_TRANSIT` | In Transit | Moving through the network |\n' +
      '| `OUT_FOR_DELIVERY` | Out for Delivery | On the delivery run |\n' +
      '| `DELIVERED` | Delivered | Received — a proof of delivery usually follows |\n' +
      '| `CANCELLED` | Cancelled | Cancelled by you or by us (`remarks` says why) |\n' +
      '| `RETURNED` | Returned | Returned to origin |\n' +
      '| `FAILED` | Failed | A delivery attempt failed |\n\n' +
      '## Rate limit\n\n' +
      '**120 requests per minute per token**, reported on every response in the standard ' +
      '`RateLimit-*` headers. A minute-by-minute poll of `GET /orders?updatedSince=` costs one.',
  },
  servers: [
    { url: 'https://imcorp.heptanesia.com/partner-api/v1', description: 'Production' },
    { url: 'http://localhost:4000/partner-api/v1', description: 'Local dev' },
  ],
  tags: [
    { name: 'Catalogue', description: 'Products enabled for you, at your configured price' },
    { name: 'Delivery', description: 'Serviceability + delivery ETA' },
    { name: 'Orders', description: 'Place orders, poll them for changes, and collect the proof of delivery' },
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
      get: {
        tags: ['Orders'],
        summary: 'List your orders — poll this for changes',
        description:
          'Newest change first. Pass `updatedSince` with the previous response\u2019s `meta.syncedAt` to ' +
          'get only what moved since; omit it for a full sync. Catches every change that matters, ' +
          'including courier scans and a proof of delivery being attached.',
        parameters: [
          { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'The previous response\u2019s meta.syncedAt' },
          { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/StatusCode' } },
          { name: 'dealerCode', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: {
          200: {
            description: 'Your orders',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/OrderView' } },
                    meta: { $ref: '#/components/schemas/SyncMeta' },
                  },
                },
              },
            },
          },
          422: { description: 'Unknown status or malformed updatedSince', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
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
        summary: 'Read one order by our orderNo or your externalRef',
        description: 'The same object `GET /orders` returns, plus a `timeline` of every transition.',
        parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Order (split orders share one externalRef)', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/OrderView' } } } } } } },
          404: { $ref: '#/components/responses/NotFound' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/orders/{ref}/epod': {
      get: {
        tags: ['Orders'],
        summary: 'Download the proof of delivery',
        description:
          'Available once an order is delivered — `epod.available` on the order says when. Default ' +
          '`format=json` returns the document base64-encoded alongside its metadata; ' +
          '`format=file` streams the raw PDF or image.\n\nIf your `externalRef` split into several orders and more than ' +
          'one has a proof, `format=file` returns **409 `AMBIGUOUS_REF`** listing the order ' +
          'numbers — pass `orderNo` to choose. `format=json` returns them all.',
        parameters: [
          { name: 'ref', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'file'], default: 'json' } },
          { name: 'orderNo', in: 'query', schema: { type: 'string' }, description: 'Pick one of the split orders' },
        ],
        responses: {
          200: {
            description: 'The proof of delivery',
            content: {
              'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/EpodDocument' } } } } },
              'application/pdf': { schema: { type: 'string', format: 'binary' } },
            },
          },
          404: { description: 'No order, or no proof captured yet', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'The reference covers several orders with a proof — pass orderNo', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: { code: 'AMBIGUOUS_REF', message: 'This reference covers 2 orders with a proof of delivery — pass ?orderNo= to choose one.', details: { orderNos: ['IMC-97227298-1', 'IMC-97227298-2'] } } } } } },
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
      StatusCode: {
        type: 'string',
        enum: ['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED', 'FAILED'],
        description: 'Stable machine value — switch on this, not on the label.',
      },
      SyncMeta: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          pageCount: { type: 'integer' },
          syncedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Pass this back as `updatedSince` on your next poll.',
          },
        },
      },
      OrderView: {
        type: 'object',
        description:
          'One order as we report it. The **same object** backs the list and the detail read, so a ' +
          'poll and a lookup can never disagree.',
        properties: {
          orderNo: { type: 'string', description: 'Our order number' },
          externalRef: { type: 'string', nullable: true, description: 'Your own order reference' },
          checkoutGroup: { type: 'string', nullable: true, description: 'Shared by the orders one submission split into' },
          status: { type: 'string', example: 'Out for Delivery', description: 'Human label — display this' },
          statusCode: { $ref: '#/components/schemas/StatusCode' },
          statusAt: { type: 'string', format: 'date-time', description: 'When the status last moved' },
          dealerCode: { type: 'string', nullable: true },
          dealerName: { type: 'string', nullable: true },
          dealerMobile: { type: 'string', nullable: true },
          deliveryInstructions: { type: 'string', nullable: true },
          remarks: { type: 'string', nullable: true, description: 'Cancellation reason, when cancelled' },
          pincode: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true },
          state: { type: 'string', nullable: true },
          awb: { type: 'string', nullable: true, description: 'Airway bill number' },
          courier: { type: 'string', nullable: true },
          courierCode: { type: 'string', nullable: true },
          tentativeDeliveryDate: { type: 'string', format: 'date-time', nullable: true, description: 'Null once delivered or closed' },
          dispatchedAt: { type: 'string', format: 'date-time', nullable: true },
          deliveredAt: { type: 'string', format: 'date-time', nullable: true },
          epod: {
            type: 'object',
            nullable: true,
            description: 'Present once a proof of delivery exists. Metadata only — fetch the document from `url`.',
            properties: {
              available: { type: 'boolean' },
              capturedAt: { type: 'string', format: 'date-time', nullable: true },
              fileName: { type: 'string', nullable: true },
              mimeType: { type: 'string', nullable: true },
              url: { type: 'string', example: '/orders/GM-9921/epod' },
            },
          },
          subtotal: { type: 'number' },
          total: { type: 'number' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string' },
                name: { type: 'string' },
                colour: { type: 'string', nullable: true },
                quantity: { type: 'integer' },
                unitPrice: { type: 'number' },
                lineTotal: { type: 'number' },
              },
            },
          },
          timeline: {
            type: 'array',
            description: 'Every transition, oldest first. Returned by `GET /orders/{ref}` only.',
            items: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                statusCode: { $ref: '#/components/schemas/StatusCode' },
                at: { type: 'string', format: 'date-time' },
                note: { type: 'string', nullable: true },
              },
            },
          },
        },
        example: {
          orderNo: 'IMC-97226830',
          externalRef: 'GM-9921',
          checkoutGroup: 'J6xPCcKxA_F2',
          status: 'Out for Delivery',
          statusCode: 'OUT_FOR_DELIVERY',
          statusAt: '2026-10-12T09:27:07.404Z',
          dealerCode: 'HK-4471',
          pincode: '400001',
          awb: 'DE7400020',
          courier: 'Delhivery',
          tentativeDeliveryDate: '2026-10-14T00:00:00.000Z',
          dispatchedAt: '2026-10-09T06:18:27.487Z',
          deliveredAt: null,
          epod: null,
          subtotal: 11022,
          total: 11022,
          items: [{ sku: 'GP-AN-1000', name: '10000mAh Power Bank', quantity: 2, unitPrice: 5511, lineTotal: 11022 }],
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } },
      },
      EpodDocument: {
        type: 'object',
        description:
          'A captured proof of delivery, returned by `GET /orders/{ref}/epod`. The document is ' +
          'embedded as base64; source files are capped at 2 MB before encoding, so expect roughly ' +
          '2.7 MB of base64 at most.',
        properties: {
          orderNo: { type: 'string' },
          externalRef: { type: 'string', nullable: true, description: 'Your own order reference' },
          dealerCode: { type: 'string', nullable: true },
          itemCodes: { type: 'array', items: { type: 'string' } },
          awb: { type: 'string', nullable: true, description: 'Airway bill number' },
          courier: { type: 'string', nullable: true },
          document: { type: 'string', format: 'byte', description: 'The document, base64-encoded' },
          documentFileName: { type: 'string', nullable: true },
          documentMimeType: {
            type: 'string',
            nullable: true,
            enum: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
          },
          capturedAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'When the courier captured the proof — not when it was uploaded',
          },
          deliveredAt: { type: 'string', format: 'date-time', nullable: true },
          checkoutGroup: { type: 'string', nullable: true },
        },
      },
    },
  },
} as const;
