export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          completed_at: string | null
          confirmation_value: string
          failure_reason: string | null
          id: string
          processing_started_at: string | null
          request_metadata: Json
          requested_at: string
          scheduled_for: string | null
          status: Database["public"]["Enums"]["deletion_request_status"]
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          confirmation_value: string
          failure_reason?: string | null
          id?: string
          processing_started_at?: string | null
          request_metadata?: Json
          requested_at?: string
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["deletion_request_status"]
          user_id: string
        }
        Update: {
          completed_at?: string | null
          confirmation_value?: string
          failure_reason?: string | null
          id?: string
          processing_started_at?: string | null
          request_metadata?: Json
          requested_at?: string
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["deletion_request_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      account_entitlements: {
        Row: {
          available_scan_credits: number
          created_at: string
          last_reconciled_at: string | null
          premium_active: boolean
          premium_expires_at: string | null
          premium_grace_ends_at: string | null
          premium_product_id: string | null
          premium_started_at: string | null
          premium_store: string | null
          reserved_scan_credits: number
          revenuecat_app_user_id: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          available_scan_credits?: number
          created_at?: string
          last_reconciled_at?: string | null
          premium_active?: boolean
          premium_expires_at?: string | null
          premium_grace_ends_at?: string | null
          premium_product_id?: string | null
          premium_started_at?: string | null
          premium_store?: string | null
          reserved_scan_credits?: number
          revenuecat_app_user_id?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          available_scan_credits?: number
          created_at?: string
          last_reconciled_at?: string | null
          premium_active?: boolean
          premium_expires_at?: string | null
          premium_grace_ends_at?: string | null
          premium_product_id?: string | null
          premium_started_at?: string | null
          premium_store?: string | null
          reserved_scan_credits?: number
          revenuecat_app_user_id?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_reward_challenges: {
        Row: {
          challenge_token_hash: string
          claimed_at: string | null
          created_at: string
          device_risk_key_hash: string | null
          expires_at: string
          id: string
          placement: string
          provider: string
          provider_transaction_id: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["ad_challenge_status"]
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          challenge_token_hash: string
          claimed_at?: string | null
          created_at?: string
          device_risk_key_hash?: string | null
          expires_at: string
          id?: string
          placement?: string
          provider: string
          provider_transaction_id?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["ad_challenge_status"]
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          challenge_token_hash?: string
          claimed_at?: string | null
          created_at?: string
          device_risk_key_hash?: string | null
          expires_at?: string
          id?: string
          placement?: string
          provider?: string
          provider_transaction_id?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["ad_challenge_status"]
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_reward_challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_fx_rates: {
        Row: {
          analysis_id: string
          created_at: string
          fx_rate_snapshot_id: string
          usage_context: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          fx_rate_snapshot_id: string
          usage_context: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          fx_rate_snapshot_id?: string
          usage_context?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_fx_rates_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "scan_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_fx_rates_fx_rate_snapshot_id_fkey"
            columns: ["fx_rate_snapshot_id"]
            isOneToOne: false
            referencedRelation: "fx_rate_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_jobs: {
        Row: {
          analysis_revision: number
          attempt_count: number
          created_at: string
          error_code: string | null
          error_detail: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          job_type: Database["public"]["Enums"]["analysis_job_type"]
          lease_expires_at: string | null
          max_attempts: number
          operation_key: string
          provider_name: string | null
          queued_at: string
          request_hash: string | null
          scan_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["analysis_job_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_revision: number
          attempt_count?: number
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type: Database["public"]["Enums"]["analysis_job_type"]
          lease_expires_at?: string | null
          max_attempts?: number
          operation_key: string
          provider_name?: string | null
          queued_at?: string
          request_hash?: string | null
          scan_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["analysis_job_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_revision?: number
          attempt_count?: number
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type?: Database["public"]["Enums"]["analysis_job_type"]
          lease_expires_at?: string | null
          max_attempts?: number
          operation_key?: string
          provider_name?: string | null
          queued_at?: string
          request_hash?: string | null
          scan_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["analysis_job_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_jobs_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: number
          metadata: Json
          request_id: string | null
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: never
          metadata?: Json
          request_id?: string | null
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: never
          metadata?: Json
          request_id?: string | null
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          display_name: string
          enabled: boolean
          launch_currency: boolean
          minor_units: number
          symbol: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_name: string
          enabled?: boolean
          launch_currency?: boolean
          minor_units: number
          symbol: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_name?: string
          enabled?: boolean
          launch_currency?: boolean
          minor_units?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      entitlement_events: {
        Row: {
          analysis_revision: number | null
          available_after: number
          created_at: string
          delta_available: number
          delta_reserved: number
          event_key: string
          event_type: Database["public"]["Enums"]["entitlement_event_type"]
          external_event_id: string | null
          id: string
          metadata: Json
          premium_after: boolean
          reserved_after: number
          scan_id: string | null
          source: string
          user_id: string
        }
        Insert: {
          analysis_revision?: number | null
          available_after: number
          created_at?: string
          delta_available?: number
          delta_reserved?: number
          event_key: string
          event_type: Database["public"]["Enums"]["entitlement_event_type"]
          external_event_id?: string | null
          id?: string
          metadata?: Json
          premium_after: boolean
          reserved_after: number
          scan_id?: string | null
          source: string
          user_id: string
        }
        Update: {
          analysis_revision?: number | null
          available_after?: number
          created_at?: string
          delta_available?: number
          delta_reserved?: number
          event_key?: string
          event_type?: Database["public"]["Enums"]["entitlement_event_type"]
          external_event_id?: string | null
          id?: string
          metadata?: Json
          premium_after?: boolean
          reserved_after?: number
          scan_id?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlement_events_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlement_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_assumptions: {
        Row: {
          active: boolean
          category: string
          created_at: string
          effective_from: string
          effective_until: string | null
          fee_rate: number
          fixed_fee_amount_minor: number
          fixed_fee_currency: string
          id: string
          marketplace: string
          source_note: string
          version: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          effective_from: string
          effective_until?: string | null
          fee_rate: number
          fixed_fee_amount_minor?: number
          fixed_fee_currency: string
          id?: string
          marketplace: string
          source_note: string
          version: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          fee_rate?: number
          fixed_fee_amount_minor?: number
          fixed_fee_currency?: string
          id?: string
          marketplace?: string
          source_note?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_assumptions_fixed_fee_currency_fkey"
            columns: ["fixed_fee_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      fx_rate_snapshots: {
        Row: {
          base_currency: string
          created_at: string
          effective_at: string
          id: string
          provider: string
          provider_reference: string | null
          quote_currency: string
          rate: number
          retrieved_at: string
        }
        Insert: {
          base_currency: string
          created_at?: string
          effective_at: string
          id?: string
          provider: string
          provider_reference?: string | null
          quote_currency: string
          rate: number
          retrieved_at?: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          effective_at?: string
          id?: string
          provider?: string
          provider_reference?: string | null
          quote_currency?: string
          rate?: number
          retrieved_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fx_rate_snapshots_base_currency_fkey"
            columns: ["base_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fx_rate_snapshots_quote_currency_fkey"
            columns: ["quote_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      idempotency_records: {
        Row: {
          completed_at: string | null
          created_at: string
          endpoint: string
          expires_at: string
          id: string
          idempotency_key: string
          locked_until: string | null
          request_hash: string
          resource_id: string | null
          resource_type: string | null
          response_body: Json | null
          response_status: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          endpoint: string
          expires_at?: string
          id?: string
          idempotency_key: string
          locked_until?: string | null
          request_hash: string
          resource_id?: string | null
          resource_type?: string | null
          response_body?: Json | null
          response_status?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          endpoint?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          locked_until?: string | null
          request_hash?: string
          resource_id?: string | null
          resource_type?: string | null
          response_body?: Json | null
          response_status?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          archived_at: string | null
          archived_from_status:
            | Database["public"]["Enums"]["inventory_status"]
            | null
          category: string | null
          condition: Database["public"]["Enums"]["item_condition"]
          cost_basis_amount_minor: number
          cost_basis_components: Json
          created_at: string
          currency: string
          id: string
          listing_date: string | null
          listing_platform: string | null
          listing_price_amount_minor: number | null
          listing_reference: string | null
          notes: string | null
          purchase_date: string
          scan_id: string | null
          sold_at: string | null
          source_analysis_id: string | null
          status: Database["public"]["Enums"]["inventory_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_from_status?:
            | Database["public"]["Enums"]["inventory_status"]
            | null
          category?: string | null
          condition?: Database["public"]["Enums"]["item_condition"]
          cost_basis_amount_minor: number
          cost_basis_components?: Json
          created_at?: string
          currency: string
          id?: string
          listing_date?: string | null
          listing_platform?: string | null
          listing_price_amount_minor?: number | null
          listing_reference?: string | null
          notes?: string | null
          purchase_date?: string
          scan_id?: string | null
          sold_at?: string | null
          source_analysis_id?: string | null
          status?: Database["public"]["Enums"]["inventory_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          archived_from_status?:
            | Database["public"]["Enums"]["inventory_status"]
            | null
          category?: string | null
          condition?: Database["public"]["Enums"]["item_condition"]
          cost_basis_amount_minor?: number
          cost_basis_components?: Json
          created_at?: string
          currency?: string
          id?: string
          listing_date?: string | null
          listing_platform?: string | null
          listing_price_amount_minor?: number | null
          listing_reference?: string | null
          notes?: string | null
          purchase_date?: string
          scan_id?: string | null
          sold_at?: string | null
          source_analysis_id?: string | null
          status?: Database["public"]["Enums"]["inventory_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "inventory_items_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_source_analysis_id_fkey"
            columns: ["source_analysis_id"]
            isOneToOne: false
            referencedRelation: "scan_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sales: {
        Row: {
          calculation_snapshot: Json
          cost_basis_snapshot_amount_minor: number
          created_at: string
          currency: string
          id: string
          inventory_item_id: string
          marketplace_fees_amount_minor: number
          other_selling_costs_amount_minor: number
          outbound_shipping_amount_minor: number
          platform: string | null
          realized_profit_amount_minor: number
          sale_date: string
          sale_price_amount_minor: number
          transaction_reference: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          calculation_snapshot: Json
          cost_basis_snapshot_amount_minor: number
          created_at?: string
          currency: string
          id?: string
          inventory_item_id: string
          marketplace_fees_amount_minor?: number
          other_selling_costs_amount_minor?: number
          outbound_shipping_amount_minor?: number
          platform?: string | null
          realized_profit_amount_minor: number
          sale_date: string
          sale_price_amount_minor: number
          transaction_reference?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          calculation_snapshot?: Json
          cost_basis_snapshot_amount_minor?: number
          created_at?: string
          currency?: string
          id?: string
          inventory_item_id?: string
          marketplace_fees_amount_minor?: number
          other_selling_costs_amount_minor?: number
          outbound_shipping_amount_minor?: number
          platform?: string | null
          realized_profit_amount_minor?: number
          sale_date?: string
          sale_price_amount_minor?: number
          transaction_reference?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sales_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "inventory_sales_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: true
            referencedRelation: "inventory_item_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sales_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: true
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sales_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_comparables: {
        Row: {
          analysis_id: string
          attributes: Json
          brand: string | null
          category: string | null
          condition: Database["public"]["Enums"]["item_condition"]
          created_at: string
          decision: Database["public"]["Enums"]["comparable_decision"]
          deduplication_key: string
          display_currency: string
          event_date: string | null
          exclusion_reason: string | null
          fx_rate_snapshot_id: string | null
          id: string
          listing_age_days: number | null
          listing_status: Database["public"]["Enums"]["market_listing_status"]
          match_score: number
          model: string | null
          price_original_amount_minor: number
          price_original_currency: string
          raw_payload_retention_until: string | null
          scan_id: string
          shipping_original_amount_minor: number | null
          shipping_original_currency: string | null
          source: string
          source_reference: string
          source_url_hash: string | null
          title: string
          total_display_amount_minor: number
          user_id: string
        }
        Insert: {
          analysis_id: string
          attributes?: Json
          brand?: string | null
          category?: string | null
          condition?: Database["public"]["Enums"]["item_condition"]
          created_at?: string
          decision: Database["public"]["Enums"]["comparable_decision"]
          deduplication_key: string
          display_currency: string
          event_date?: string | null
          exclusion_reason?: string | null
          fx_rate_snapshot_id?: string | null
          id?: string
          listing_age_days?: number | null
          listing_status?: Database["public"]["Enums"]["market_listing_status"]
          match_score: number
          model?: string | null
          price_original_amount_minor: number
          price_original_currency: string
          raw_payload_retention_until?: string | null
          scan_id: string
          shipping_original_amount_minor?: number | null
          shipping_original_currency?: string | null
          source: string
          source_reference: string
          source_url_hash?: string | null
          title: string
          total_display_amount_minor: number
          user_id: string
        }
        Update: {
          analysis_id?: string
          attributes?: Json
          brand?: string | null
          category?: string | null
          condition?: Database["public"]["Enums"]["item_condition"]
          created_at?: string
          decision?: Database["public"]["Enums"]["comparable_decision"]
          deduplication_key?: string
          display_currency?: string
          event_date?: string | null
          exclusion_reason?: string | null
          fx_rate_snapshot_id?: string | null
          id?: string
          listing_age_days?: number | null
          listing_status?: Database["public"]["Enums"]["market_listing_status"]
          match_score?: number
          model?: string | null
          price_original_amount_minor?: number
          price_original_currency?: string
          raw_payload_retention_until?: string | null
          scan_id?: string
          shipping_original_amount_minor?: number | null
          shipping_original_currency?: string | null
          source?: string
          source_reference?: string
          source_url_hash?: string | null
          title?: string
          total_display_amount_minor?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_comparables_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "scan_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_comparables_display_currency_fkey"
            columns: ["display_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "market_comparables_fx_rate_snapshot_id_fkey"
            columns: ["fx_rate_snapshot_id"]
            isOneToOne: false
            referencedRelation: "fx_rate_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_comparables_price_original_currency_fkey"
            columns: ["price_original_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "market_comparables_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_comparables_shipping_original_currency_fkey"
            columns: ["shipping_original_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "market_comparables_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          deletion_requested_at: string | null
          id: string
          notifications_enabled: boolean
          preferred_currency: string
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deletion_requested_at?: string | null
          id: string
          notifications_enabled?: boolean
          preferred_currency?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deletion_requested_at?: string | null
          id?: string
          notifications_enabled?: boolean
          preferred_currency?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_preferred_currency_fkey"
            columns: ["preferred_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      provider_operations: {
        Row: {
          attempt_count: number
          created_at: string
          duration_ms: number | null
          error_code: string | null
          external_request_id: string | null
          id: string
          job_id: string | null
          operation: string
          operation_key: string
          payload_expires_at: string | null
          provider: string
          provider_cost_units: number | null
          request_fingerprint: string | null
          scan_id: string | null
          status: Database["public"]["Enums"]["analysis_job_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          external_request_id?: string | null
          id?: string
          job_id?: string | null
          operation: string
          operation_key: string
          payload_expires_at?: string | null
          provider: string
          provider_cost_units?: number | null
          request_fingerprint?: string | null
          scan_id?: string | null
          status?: Database["public"]["Enums"]["analysis_job_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempt_count?: number
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          external_request_id?: string | null
          id?: string
          job_id?: string | null
          operation?: string
          operation_key?: string
          payload_expires_at?: string | null
          provider?: string
          provider_cost_units?: number | null
          request_fingerprint?: string | null
          scan_id?: string | null
          status?: Database["public"]["Enums"]["analysis_job_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_operations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "analysis_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_operations_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_operations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recognition_candidates: {
        Row: {
          accessories_seen: string[]
          attributes: Json
          brand: string | null
          candidate_key: string
          category: string | null
          condition: Database["public"]["Enums"]["item_condition"]
          confidence: number
          created_at: string
          id: string
          model: string | null
          prompt_version: string | null
          provider: string
          provider_model: string | null
          rank: number
          scan_id: string
          title: string
          uncertainties: string[]
          user_id: string
        }
        Insert: {
          accessories_seen?: string[]
          attributes?: Json
          brand?: string | null
          candidate_key: string
          category?: string | null
          condition?: Database["public"]["Enums"]["item_condition"]
          confidence: number
          created_at?: string
          id?: string
          model?: string | null
          prompt_version?: string | null
          provider: string
          provider_model?: string | null
          rank: number
          scan_id: string
          title: string
          uncertainties?: string[]
          user_id: string
        }
        Update: {
          accessories_seen?: string[]
          attributes?: Json
          brand?: string | null
          candidate_key?: string
          category?: string | null
          condition?: Database["public"]["Enums"]["item_condition"]
          confidence?: number
          created_at?: string
          id?: string
          model?: string | null
          prompt_version?: string | null
          provider?: string
          provider_model?: string | null
          rank?: number
          scan_id?: string
          title?: string
          uncertainties?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recognition_candidates_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recognition_candidates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_analyses: {
        Row: {
          assumptions: Json
          calculation_version: string
          comparable_count: number
          completed_at: string
          confidence: Database["public"]["Enums"]["confidence_level"]
          created_at: string
          display_currency: string
          estimated_net_profit_amount_minor: number
          fee_assumption_version: string | null
          freshness_at: string
          id: string
          included_active_count: number
          included_sold_count: number
          input_snapshot: Json
          maximum_buy_price_amount_minor: number
          maximum_return_amount_minor: number
          normal_return_amount_minor: number
          quick_return_amount_minor: number
          recognition_snapshot: Json
          revision: number
          roi_percent: number | null
          scan_id: string
          score_components: Json
          total_cash_invested_amount_minor: number
          user_id: string
          warnings: Json
          worth_score: number
        }
        Insert: {
          assumptions?: Json
          calculation_version: string
          comparable_count: number
          completed_at?: string
          confidence: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          display_currency: string
          estimated_net_profit_amount_minor: number
          fee_assumption_version?: string | null
          freshness_at: string
          id?: string
          included_active_count?: number
          included_sold_count?: number
          input_snapshot: Json
          maximum_buy_price_amount_minor: number
          maximum_return_amount_minor: number
          normal_return_amount_minor: number
          quick_return_amount_minor: number
          recognition_snapshot?: Json
          revision: number
          roi_percent?: number | null
          scan_id: string
          score_components?: Json
          total_cash_invested_amount_minor: number
          user_id: string
          warnings?: Json
          worth_score: number
        }
        Update: {
          assumptions?: Json
          calculation_version?: string
          comparable_count?: number
          completed_at?: string
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          display_currency?: string
          estimated_net_profit_amount_minor?: number
          fee_assumption_version?: string | null
          freshness_at?: string
          id?: string
          included_active_count?: number
          included_sold_count?: number
          input_snapshot?: Json
          maximum_buy_price_amount_minor?: number
          maximum_return_amount_minor?: number
          normal_return_amount_minor?: number
          quick_return_amount_minor?: number
          recognition_snapshot?: Json
          revision?: number
          roi_percent?: number | null
          scan_id?: string
          score_components?: Json
          total_cash_invested_amount_minor?: number
          user_id?: string
          warnings?: Json
          worth_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "scan_analyses_display_currency_fkey"
            columns: ["display_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "scan_analyses_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_analyses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_images: {
        Row: {
          byte_size: number | null
          created_at: string
          height_pixels: number | null
          id: string
          mime_type: string
          original_filename: string | null
          rejection_reason: string | null
          scan_id: string
          sha256_hex: string | null
          sort_order: number
          storage_bucket: string
          storage_path: string
          updated_at: string
          upload_status: Database["public"]["Enums"]["image_upload_status"]
          user_id: string
          verified_at: string | null
          width_pixels: number | null
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          height_pixels?: number | null
          id?: string
          mime_type: string
          original_filename?: string | null
          rejection_reason?: string | null
          scan_id: string
          sha256_hex?: string | null
          sort_order?: number
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          upload_status?: Database["public"]["Enums"]["image_upload_status"]
          user_id: string
          verified_at?: string | null
          width_pixels?: number | null
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          height_pixels?: number | null
          id?: string
          mime_type?: string
          original_filename?: string | null
          rejection_reason?: string | null
          scan_id?: string
          sha256_hex?: string | null
          sort_order?: number
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          upload_status?: Database["public"]["Enums"]["image_upload_status"]
          user_id?: string
          verified_at?: string | null
          width_pixels?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_images_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_images_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_items: {
        Row: {
          accessories: string[]
          attributes: Json
          brand: string | null
          candidate_id: string | null
          category: string
          condition: Database["public"]["Enums"]["item_condition"]
          confirmed_at: string | null
          created_at: string
          id: string
          inbound_shipping_amount_minor: number | null
          inbound_shipping_currency: string | null
          model: string | null
          notes: string | null
          other_acquisition_costs_amount_minor: number | null
          other_acquisition_costs_currency: string | null
          outbound_shipping_amount_minor: number | null
          outbound_shipping_currency: string | null
          recognition_confidence: number | null
          repair_cost_amount_minor: number | null
          repair_cost_currency: string | null
          scan_id: string
          taxes_paid_amount_minor: number | null
          taxes_paid_currency: string | null
          title: string
          updated_at: string
          user_confirmed: boolean
          user_id: string
        }
        Insert: {
          accessories?: string[]
          attributes?: Json
          brand?: string | null
          candidate_id?: string | null
          category: string
          condition?: Database["public"]["Enums"]["item_condition"]
          confirmed_at?: string | null
          created_at?: string
          id?: string
          inbound_shipping_amount_minor?: number | null
          inbound_shipping_currency?: string | null
          model?: string | null
          notes?: string | null
          other_acquisition_costs_amount_minor?: number | null
          other_acquisition_costs_currency?: string | null
          outbound_shipping_amount_minor?: number | null
          outbound_shipping_currency?: string | null
          recognition_confidence?: number | null
          repair_cost_amount_minor?: number | null
          repair_cost_currency?: string | null
          scan_id: string
          taxes_paid_amount_minor?: number | null
          taxes_paid_currency?: string | null
          title: string
          updated_at?: string
          user_confirmed?: boolean
          user_id: string
        }
        Update: {
          accessories?: string[]
          attributes?: Json
          brand?: string | null
          candidate_id?: string | null
          category?: string
          condition?: Database["public"]["Enums"]["item_condition"]
          confirmed_at?: string | null
          created_at?: string
          id?: string
          inbound_shipping_amount_minor?: number | null
          inbound_shipping_currency?: string | null
          model?: string | null
          notes?: string | null
          other_acquisition_costs_amount_minor?: number | null
          other_acquisition_costs_currency?: string | null
          outbound_shipping_amount_minor?: number | null
          outbound_shipping_currency?: string | null
          recognition_confidence?: number | null
          repair_cost_amount_minor?: number | null
          repair_cost_currency?: string | null
          scan_id?: string
          taxes_paid_amount_minor?: number | null
          taxes_paid_currency?: string | null
          title?: string
          updated_at?: string
          user_confirmed?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_items_inbound_shipping_currency_fkey"
            columns: ["inbound_shipping_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "scan_items_other_acquisition_costs_currency_fkey"
            columns: ["other_acquisition_costs_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "scan_items_outbound_shipping_currency_fkey"
            columns: ["outbound_shipping_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "scan_items_repair_cost_currency_fkey"
            columns: ["repair_cost_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "scan_items_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: true
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_items_taxes_paid_currency_fkey"
            columns: ["taxes_paid_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "scan_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scans: {
        Row: {
          cancelled_at: string | null
          category_hint: string | null
          completed_at: string | null
          created_at: string
          current_analysis_revision: number
          id: string
          preferred_currency: string
          purchase_price_amount_minor: number | null
          purchase_price_currency: string | null
          source_context: string | null
          status: Database["public"]["Enums"]["scan_status"]
          status_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          category_hint?: string | null
          completed_at?: string | null
          created_at?: string
          current_analysis_revision?: number
          id?: string
          preferred_currency: string
          purchase_price_amount_minor?: number | null
          purchase_price_currency?: string | null
          source_context?: string | null
          status?: Database["public"]["Enums"]["scan_status"]
          status_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          category_hint?: string | null
          completed_at?: string | null
          created_at?: string
          current_analysis_revision?: number
          id?: string
          preferred_currency?: string
          purchase_price_amount_minor?: number | null
          purchase_price_currency?: string | null
          source_context?: string | null
          status?: Database["public"]["Enums"]["scan_status"]
          status_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scans_preferred_currency_fkey"
            columns: ["preferred_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "scans_purchase_price_currency_fkey"
            columns: ["purchase_price_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "scans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      supported_categories: {
        Row: {
          code: string
          created_at: string
          display_name: string
          enabled: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_name: string
          enabled?: boolean
          sort_order: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_name?: string
          enabled?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          error_code: string | null
          error_detail: string | null
          event_type: string | null
          external_event_id: string
          id: string
          payload: Json
          processed_at: string | null
          processing_status: Database["public"]["Enums"]["webhook_processing_status"]
          provider: Database["public"]["Enums"]["webhook_provider"]
          received_at: string
          retention_until: string | null
          signature_verified: boolean
          user_id: string | null
          verified_at: string | null
        }
        Insert: {
          error_code?: string | null
          error_detail?: string | null
          event_type?: string | null
          external_event_id: string
          id?: string
          payload: Json
          processed_at?: string | null
          processing_status?: Database["public"]["Enums"]["webhook_processing_status"]
          provider: Database["public"]["Enums"]["webhook_provider"]
          received_at?: string
          retention_until?: string | null
          signature_verified?: boolean
          user_id?: string | null
          verified_at?: string | null
        }
        Update: {
          error_code?: string | null
          error_detail?: string | null
          event_type?: string | null
          external_event_id?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_status?: Database["public"]["Enums"]["webhook_processing_status"]
          provider?: Database["public"]["Enums"]["webhook_provider"]
          received_at?: string
          retention_until?: string | null
          signature_verified?: boolean
          user_id?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      inventory_item_summaries: {
        Row: {
          category: string | null
          condition: Database["public"]["Enums"]["item_condition"] | null
          cost_basis_amount_minor: number | null
          created_at: string | null
          currency: string | null
          id: string | null
          listing_date: string | null
          listing_platform: string | null
          listing_price_amount_minor: number | null
          listing_reference: string | null
          marketplace_fees_amount_minor: number | null
          other_selling_costs_amount_minor: number | null
          outbound_shipping_amount_minor: number | null
          purchase_date: string | null
          realized_profit_amount_minor: number | null
          sale_date: string | null
          sale_price_amount_minor: number | null
          scan_id: string | null
          source_analysis_id: string | null
          status: Database["public"]["Enums"]["inventory_status"] | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "inventory_items_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_source_analysis_id_fkey"
            columns: ["source_analysis_id"]
            isOneToOne: false
            referencedRelation: "scan_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      apply_premium_entitlement: {
        Args: {
          p_active: boolean
          p_event_type: Database["public"]["Enums"]["entitlement_event_type"]
          p_expires_at: string
          p_external_event_id: string
          p_grace_ends_at: string
          p_metadata?: Json
          p_product_id: string
          p_revenuecat_app_user_id: string
          p_started_at: string
          p_store: string
          p_user_id: string
        }
        Returns: boolean
      }
      begin_market_analysis: {
        Args: {
          p_idempotency_key: string
          p_request_hash: string
          p_scan_id: string
        }
        Returns: Json
      }
      can_read_inventory: { Args: { p_user_id: string }; Returns: boolean }
      claim_analysis_job: {
        Args: { p_lease_seconds?: number; p_worker_name: string }
        Returns: {
          analysis_revision: number
          attempt_count: number
          created_at: string
          error_code: string | null
          error_detail: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          job_type: Database["public"]["Enums"]["analysis_job_type"]
          lease_expires_at: string | null
          max_attempts: number
          operation_key: string
          provider_name: string | null
          queued_at: string
          request_hash: string | null
          scan_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["analysis_job_status"]
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "analysis_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      consume_scan_reservation: {
        Args: { p_analysis_revision: number; p_scan_id: string }
        Returns: boolean
      }
      get_my_account_summary: {
        Args: never
        Returns: {
          available_scan_credits: number
          created_at: string
          id: string
          inventory_read_only: boolean
          notifications_enabled: boolean
          plan: string
          preferred_currency: string
          premium_expires_at: string
          reserved_scan_credits: number
          updated_at: string
        }[]
      }
      grant_rewarded_ad_credit: {
        Args: { p_challenge_id: string; p_provider_transaction_id: string }
        Returns: Json
      }
      is_premium_active: { Args: { p_user_id: string }; Returns: boolean }
      is_service_actor: { Args: never; Returns: boolean }
      record_inventory_sale: {
        Args: {
          p_inventory_item_id: string
          p_marketplace_fees_amount_minor: number
          p_other_selling_costs_amount_minor: number
          p_outbound_shipping_amount_minor: number
          p_platform: string
          p_sale_date: string
          p_sale_price_amount_minor: number
          p_transaction_reference: string
        }
        Returns: string
      }
      release_scan_reservation: {
        Args: {
          p_analysis_revision: number
          p_reason?: string
          p_scan_id: string
        }
        Returns: boolean
      }
      request_account_deletion: {
        Args: { p_confirmation: string }
        Returns: string
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      account_status:
        | "active"
        | "deletion_requested"
        | "deleting"
        | "deleted"
        | "suspended"
      ad_challenge_status:
        | "pending"
        | "verified"
        | "claimed"
        | "expired"
        | "rejected"
      analysis_job_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
      analysis_job_type: "identification" | "market_analysis"
      comparable_decision: "included" | "excluded"
      confidence_level: "low" | "medium" | "high"
      deletion_request_status:
        | "requested"
        | "scheduled"
        | "processing"
        | "completed"
        | "cancelled"
        | "failed"
      entitlement_event_type:
        | "introductory_grant"
        | "rewarded_ad_grant"
        | "scan_reserved"
        | "scan_consumed"
        | "scan_released"
        | "premium_activated"
        | "premium_renewed"
        | "premium_expired"
        | "premium_revoked"
        | "premium_restored"
        | "administrative_correction"
      image_upload_status:
        | "pending"
        | "uploaded"
        | "verified"
        | "rejected"
        | "deleted"
      inventory_status: "acquired" | "listed" | "sold" | "archived"
      item_condition:
        | "new"
        | "open_box"
        | "like_new"
        | "excellent"
        | "good"
        | "fair"
        | "poor"
        | "for_parts"
        | "unknown"
      market_listing_status: "active" | "sold" | "ended" | "unknown"
      scan_status:
        | "draft"
        | "uploaded"
        | "identifying"
        | "ready"
        | "analyzing"
        | "completed"
        | "identification_failed"
        | "analysis_failed"
        | "cancelled"
      webhook_processing_status:
        | "received"
        | "verified"
        | "processed"
        | "rejected"
        | "failed"
      webhook_provider: "revenuecat" | "ad_provider"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: [
        "active",
        "deletion_requested",
        "deleting",
        "deleted",
        "suspended",
      ],
      ad_challenge_status: [
        "pending",
        "verified",
        "claimed",
        "expired",
        "rejected",
      ],
      analysis_job_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
      ],
      analysis_job_type: ["identification", "market_analysis"],
      comparable_decision: ["included", "excluded"],
      confidence_level: ["low", "medium", "high"],
      deletion_request_status: [
        "requested",
        "scheduled",
        "processing",
        "completed",
        "cancelled",
        "failed",
      ],
      entitlement_event_type: [
        "introductory_grant",
        "rewarded_ad_grant",
        "scan_reserved",
        "scan_consumed",
        "scan_released",
        "premium_activated",
        "premium_renewed",
        "premium_expired",
        "premium_revoked",
        "premium_restored",
        "administrative_correction",
      ],
      image_upload_status: [
        "pending",
        "uploaded",
        "verified",
        "rejected",
        "deleted",
      ],
      inventory_status: ["acquired", "listed", "sold", "archived"],
      item_condition: [
        "new",
        "open_box",
        "like_new",
        "excellent",
        "good",
        "fair",
        "poor",
        "for_parts",
        "unknown",
      ],
      market_listing_status: ["active", "sold", "ended", "unknown"],
      scan_status: [
        "draft",
        "uploaded",
        "identifying",
        "ready",
        "analyzing",
        "completed",
        "identification_failed",
        "analysis_failed",
        "cancelled",
      ],
      webhook_processing_status: [
        "received",
        "verified",
        "processed",
        "rejected",
        "failed",
      ],
      webhook_provider: ["revenuecat", "ad_provider"],
    },
  },
} as const
