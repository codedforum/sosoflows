// SoDEX order envelope builder.
// Produces a complete EIP-712 typed-data object a wallet can sign with
// eth_signTypedData_v4, plus the alpha-sorted canonical JSON payload and a
// millisecond nonce. This mirrors the SoSoFlows dashboard signing path so the
// moment the SoDEX testnet gateway opens, the same envelope submits unchanged.
//
// NOTE: this tool only PREPARES the envelope. Signing and submission happen in
// the user's own wallet. No keys are handled here.

const VALUECHAIN_TESTNET = 138565;

// Deterministic, alpha-sorted compact JSON (stable key order) so the
// payloadHash is reproducible across clients.
function canonical(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  if (obj && typeof obj === 'object') {
    return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }
  return JSON.stringify(obj);
}

export function buildOrderEnvelope({
  symbol = 'BTC',
  side = 'BUY',
  sizeUsd = 100,
  price = 0,
  orderType = 'MARKET',
  account = '0x0000000000000000000000000000000000000000',
  chainId = VALUECHAIN_TESTNET,
  verifyingContract = '0x0000000000000000000000000000000000000000',
} = {}) {
  side = String(side).toUpperCase();
  orderType = String(orderType).toUpperCase();
  symbol = String(symbol).toUpperCase();
  const nonce = Date.now(); // millisecond, single-use

  const message = {
    account,
    symbol: `${symbol}-USD`,
    side,
    orderType,
    sizeUsd: String(sizeUsd),
    price: String(price),
    nonce: String(nonce),
  };

  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ExchangeAction: [
        { name: 'account', type: 'address' },
        { name: 'symbol', type: 'string' },
        { name: 'side', type: 'string' },
        { name: 'orderType', type: 'string' },
        { name: 'sizeUsd', type: 'string' },
        { name: 'price', type: 'string' },
        { name: 'nonce', type: 'string' },
      ],
    },
    primaryType: 'ExchangeAction',
    domain: { name: 'SoDEX', version: '1', chainId, verifyingContract },
    message,
  };

  const payload = canonical(message);

  return {
    chain: { name: 'ValueChain testnet', chainId },
    typedData,
    canonicalPayload: payload,
    nonce,
    signing: {
      method: 'eth_signTypedData_v4',
      note: 'Sign typedData in the connected wallet. SoDEX expects a 0x01-prefixed typed signature. payloadHash = keccak256(canonicalPayload).',
      header_spec: { 'X-API-Key': '<signer EVM address>', 'X-Sign': '<signature>', 'X-Nonce': String(nonce) },
      submit_to: 'POST https://testnet-api.sodex.com/v1/order/new (gateway opens per SoDEX schedule)',
    },
    status: 'prepared (not signed, not submitted)',
  };
}
