/**
 * Webhook Routes
 *
 * Handles incoming webhooks from Stripe.
 * Webhooks are the source of truth for payment events.
 *
 * Endpoints:
 * - POST /webhooks/stripe - Receive Stripe webhook events
 */

import express from "express";
import Stripe from "stripe";
import { checkouts } from "./checkouts.js";

const router = express.Router();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * POST /webhooks/stripe - Handle Stripe webhook events
 *
 * IMPORTANT: This route uses express.raw() middleware instead of express.json()
 * because Stripe needs the raw request body to verify the signature.
 */
router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    // TODO: Verify webhook signature
    // This ensures the request really came from Stripe
    // Replace this entire block with the verification code from the workshop instructions
    // Verify webhook signature - this ensures the request really came from Stripe
    let event;
    try {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("⚠️ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // After verification, handle the event:
    await handleEvent(event);
    res.json({ received: true });
  },
);

/**
 * Handle webhook events
 * Calls the Merchant Catalog API to update stock
 */
async function handleEvent(event) {
  // TODO: Handle payment_intent.succeeded event
  // - Find the checkout by payment_intent_id
  // - Mark it as webhook-confirmed
  // - Call the catalog stock endpoint to decrement stock
  // - Log the confirmation
  // Handle payment_intent.succeeded event
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    console.log("✅ Webhook: Payment confirmed:", paymentIntent.id);

    // Find checkout with this payment_intent_id
    for (const [checkoutId, checkout] of checkouts) {
      if (checkout.payment_intent_id === paymentIntent.id) {
        // Mark as webhook-confirmed
        checkout.webhook_confirmed = true;
        checkout.webhook_confirmed_at = new Date().toISOString();

        // Record sales via the catalog API (updates JSON file AND records in sales history)
        // Stock is ONLY decremented when webhook confirms payment!
        if (!checkout.stock_reserved) {
          console.log("📦 Webhook: Recording sales via Catalog API");
          const merchantBaseUrl = `http://localhost:${process.env.PORT || 4000}`;
          const catalogName = checkout.catalog;

          for (const lineItem of checkout.line_items) {
            try {
              const response = await fetch(
                `${merchantBaseUrl}/api/${catalogName}/sale`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    productId: lineItem.id,
                    quantity: lineItem.item.quantity,
                    orderId: checkout.order?.id,
                  }),
                },
              );
              const result = await response.json();
              if (result.success) {
                console.log(
                  `   ✅ Sale recorded: ${lineItem.item.quantity}x ${lineItem.title}`,
                );
              }
            } catch (err) {
              console.error(`   ❌ Sale recording failed:`, err.message);
            }
          }
          checkout.stock_reserved = true;
        }

        console.log("🎉 Webhook: Order confirmed for fulfillment:", checkoutId);
        break;
      }
    }
  }

  // TODO: (Optional) Handle payment_intent.payment_failed
  // Handle payment failures
  if (event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object;
    console.log("❌ Webhook: Payment failed:", paymentIntent.id);
    console.log(
      "   Reason:",
      paymentIntent.last_payment_error?.message || "Unknown",
    );

    // You could notify the Agent or update checkout status here
  }

  console.log("ℹ️ Webhook event received:", event.type);
}

export default router;
