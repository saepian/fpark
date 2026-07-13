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
      articles: {
        Row: {
          category: string
          created_at: string | null
          id: string
          image_url: string | null
          original_url: string
          published_at: string | null
          source: string
          stocks: Json | null
          sub_category: string | null
          summary: string | null
          title: string
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          original_url: string
          published_at?: string | null
          source: string
          stocks?: Json | null
          sub_category?: string | null
          summary?: string | null
          title: string
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          original_url?: string
          published_at?: string | null
          source?: string
          stocks?: Json | null
          sub_category?: string | null
          summary?: string | null
          title?: string
        }
        Relationships: []
      }
      bank_transfer_requests: {
        Row: {
          amount: number
          created_at: string
          depositor_name: string
          depositor_real_name: string | null
          id: string
          is_annual: boolean
          plan: string
          processed_at: string | null
          processed_by: string | null
          request_type: string
          requested_at: string
          status: string
          superseded_by: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          depositor_name: string
          depositor_real_name?: string | null
          id?: string
          is_annual?: boolean
          plan: string
          processed_at?: string | null
          processed_by?: string | null
          request_type?: string
          requested_at?: string
          status?: string
          superseded_by?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          depositor_name?: string
          depositor_real_name?: string | null
          id?: string
          is_annual?: boolean
          plan?: string
          processed_at?: string | null
          processed_by?: string | null
          request_type?: string
          requested_at?: string
          status?: string
          superseded_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      billing_executions: {
        Row: {
          created_at: string
          executed_date: string
          id: string
        }
        Insert: {
          created_at?: string
          executed_date: string
          id?: string
        }
        Update: {
          created_at?: string
          executed_date?: string
          id?: string
        }
        Relationships: []
      }
      contact_submissions: {
        Row: {
          category: string | null
          created_at: string | null
          email: string
          id: string
          ip_address: string | null
          message: string
          name: string
          subject: string
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          email: string
          id?: string
          ip_address?: string | null
          message: string
          name: string
          subject: string
        }
        Update: {
          category?: string | null
          created_at?: string | null
          email?: string
          id?: string
          ip_address?: string | null
          message?: string
          name?: string
          subject?: string
        }
        Relationships: []
      }
      daily_picks: {
        Row: {
          analysis: string | null
          catalysts: string[] | null
          created_at: string | null
          date: string
          foreign_consecutive_days: number | null
          foreign_net_buy_auk: number | null
          id: string
          institution_consecutive_days: number | null
          institution_net_buy_auk: number | null
          keywords: string[] | null
          name: string
          news_used: Json | null
          pick_reason: string | null
          price_at_pick: number | null
          risks: string[] | null
          sentiment: string | null
          summary: string | null
          target_price: string | null
          ticker: string
          week52_high: number | null
          week52_low: number | null
        }
        Insert: {
          analysis?: string | null
          catalysts?: string[] | null
          created_at?: string | null
          date?: string
          foreign_consecutive_days?: number | null
          foreign_net_buy_auk?: number | null
          id?: string
          institution_consecutive_days?: number | null
          institution_net_buy_auk?: number | null
          keywords?: string[] | null
          name: string
          news_used?: Json | null
          pick_reason?: string | null
          price_at_pick?: number | null
          risks?: string[] | null
          sentiment?: string | null
          summary?: string | null
          target_price?: string | null
          ticker: string
          week52_high?: number | null
          week52_low?: number | null
        }
        Update: {
          analysis?: string | null
          catalysts?: string[] | null
          created_at?: string | null
          date?: string
          foreign_consecutive_days?: number | null
          foreign_net_buy_auk?: number | null
          id?: string
          institution_consecutive_days?: number | null
          institution_net_buy_auk?: number | null
          keywords?: string[] | null
          name?: string
          news_used?: Json | null
          pick_reason?: string | null
          price_at_pick?: number | null
          risks?: string[] | null
          sentiment?: string | null
          summary?: string | null
          target_price?: string | null
          ticker?: string
          week52_high?: number | null
          week52_low?: number | null
        }
        Relationships: []
      }
      email_send_logs: {
        Row: {
          ai_comment: string | null
          id: string
          notification_count: number
          sent_at: string
          status: string
          stock_count: number
          user_id: string
        }
        Insert: {
          ai_comment?: string | null
          id?: string
          notification_count?: number
          sent_at?: string
          status?: string
          stock_count?: number
          user_id: string
        }
        Update: {
          ai_comment?: string | null
          id?: string
          notification_count?: number
          sent_at?: string
          status?: string
          stock_count?: number
          user_id?: string
        }
        Relationships: []
      }
      codef_tokens: {
        Row: {
          access_token: string
          created_at: string
          expired_at: string
          id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expired_at: string
          id?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expired_at?: string
          id?: string
        }
        Relationships: []
      }
      codef_connected_accounts: {
        Row: {
          business_registration_number: string | null
          connected_id: string
          bank_name: string
          created_at: string
          id: string
        }
        Insert: {
          business_registration_number?: string | null
          connected_id: string
          bank_name: string
          created_at?: string
          id?: string
        }
        Update: {
          business_registration_number?: string | null
          connected_id?: string
          bank_name?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      kis_tokens: {
        Row: {
          access_token: string
          created_at: string | null
          expired_at: string
          id: number
        }
        Insert: {
          access_token: string
          created_at?: string | null
          expired_at: string
          id?: number
        }
        Update: {
          access_token?: string
          created_at?: string | null
          expired_at?: string
          id?: number
        }
        Relationships: []
      }
      market_cache: {
        Row: {
          data: Json
          key: string
          updated_at: string
        }
        Insert: {
          data: Json
          key: string
          updated_at?: string
        }
        Update: {
          data?: Json
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          current_value: number
          id: string
          is_active: boolean
          is_read: boolean
          message: string
          notif_date: string
          stock_code: string
          stock_name: string
          threshold: number
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_value: number
          id?: string
          is_active?: boolean
          is_read?: boolean
          message: string
          notif_date?: string
          stock_code: string
          stock_name: string
          threshold: number
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_value?: number
          id?: string
          is_active?: boolean
          is_read?: boolean
          message?: string
          notif_date?: string
          stock_code?: string
          stock_name?: string
          threshold?: number
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          billing_key: string | null
          created_at: string
          id: string
          is_annual: boolean
          payment_id: string
          payment_method: string | null
          plan: string
          status: string
          user_id: string
          va_account_number: string | null
          va_bank: string | null
          va_due_at: string | null
        }
        Insert: {
          amount: number
          billing_key?: string | null
          created_at?: string
          id?: string
          is_annual?: boolean
          payment_id: string
          payment_method?: string | null
          plan: string
          status?: string
          user_id: string
          va_account_number?: string | null
          va_bank?: string | null
          va_due_at?: string | null
        }
        Update: {
          amount?: number
          billing_key?: string | null
          created_at?: string
          id?: string
          is_annual?: boolean
          payment_id?: string
          payment_method?: string | null
          plan?: string
          status?: string
          user_id?: string
          va_account_number?: string | null
          va_bank?: string | null
          va_due_at?: string | null
        }
        Relationships: []
      }
      portfolio_diagnosis: {
        Row: {
          created_at: string | null
          id: string
          result: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          result?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          result?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      refund_requests: {
        Row: {
          created_at: string
          diagnosis_count: number
          elapsed_days: number
          elapsed_ratio: number
          final_ratio: number
          id: string
          paid_amount: number
          plan: string
          portfolio_count: number
          processed_at: string | null
          processed_by: string | null
          refund_account_bank: string | null
          refund_account_holder: string | null
          refund_account_number: string | null
          refund_amount: number
          refund_reason: string | null
          refund_status: string
          requested_at: string
          subscription_start_date: string
          usage_detected: boolean
          usage_ratio: number
          user_id: string
        }
        Insert: {
          created_at?: string
          diagnosis_count?: number
          elapsed_days: number
          elapsed_ratio?: number
          final_ratio?: number
          id?: string
          paid_amount: number
          plan: string
          portfolio_count?: number
          processed_at?: string | null
          processed_by?: string | null
          refund_account_bank?: string | null
          refund_account_holder?: string | null
          refund_account_number?: string | null
          refund_amount?: number
          refund_reason?: string | null
          refund_status?: string
          requested_at?: string
          subscription_start_date: string
          usage_detected: boolean
          usage_ratio?: number
          user_id: string
        }
        Update: {
          created_at?: string
          diagnosis_count?: number
          elapsed_days?: number
          elapsed_ratio?: number
          final_ratio?: number
          id?: string
          paid_amount?: number
          plan?: string
          portfolio_count?: number
          processed_at?: string | null
          processed_by?: string | null
          refund_account_bank?: string | null
          refund_account_holder?: string | null
          refund_account_number?: string | null
          refund_amount?: number
          refund_reason?: string | null
          refund_status?: string
          requested_at?: string
          subscription_start_date?: string
          usage_detected?: boolean
          usage_ratio?: number
          user_id?: string
        }
        Relationships: []
      }
      shared_reports: {
        Row: {
          created_at: string
          data: Json
          expires_at: string
          id: string
          type: string
        }
        Insert: {
          created_at?: string
          data: Json
          expires_at: string
          id?: string
          type: string
        }
        Update: {
          created_at?: string
          data?: Json
          expires_at?: string
          id?: string
          type?: string
        }
        Relationships: []
      }
      stock_analysis: {
        Row: {
          created_at: string | null
          details: string | null
          keywords: string[] | null
          sentiment: string | null
          summary: string | null
          ticker: string
        }
        Insert: {
          created_at?: string | null
          details?: string | null
          keywords?: string[] | null
          sentiment?: string | null
          summary?: string | null
          ticker: string
        }
        Update: {
          created_at?: string | null
          details?: string | null
          keywords?: string[] | null
          sentiment?: string | null
          summary?: string | null
          ticker?: string
        }
        Relationships: []
      }
      stock_analysis_history: {
        Row: {
          created_at: string
          current_price: number | null
          disclaimer: string | null
          headline: string
          id: number
          internal_metrics: Json
          main_analysis: string
          price_change_pct: number | null
          reference_metrics: Json
          report_date: string
          report_type: string
          risk_factor: string | null
          sentiment: string | null
          signal: string | null
          tags: string[] | null
          ticker: string
          yesterday_delta: string | null
        }
        Insert: {
          created_at?: string
          current_price?: number | null
          disclaimer?: string | null
          headline: string
          id?: number
          internal_metrics?: Json
          main_analysis: string
          price_change_pct?: number | null
          reference_metrics?: Json
          report_date: string
          report_type: string
          risk_factor?: string | null
          sentiment?: string | null
          signal?: string | null
          tags?: string[] | null
          ticker: string
          yesterday_delta?: string | null
        }
        Update: {
          created_at?: string
          current_price?: number | null
          disclaimer?: string | null
          headline?: string
          id?: number
          internal_metrics?: Json
          main_analysis?: string
          price_change_pct?: number | null
          reference_metrics?: Json
          report_date?: string
          report_type?: string
          risk_factor?: string | null
          sentiment?: string | null
          signal?: string | null
          tags?: string[] | null
          ticker?: string
          yesterday_delta?: string | null
        }
        Relationships: []
      }
      stock_diagnosis: {
        Row: {
          avg_price: number
          buy_date: string | null
          created_at: string | null
          id: string
          name: string
          quantity: number
          report_date: string | null
          result: Json | null
          ticker: string
          user_id: string | null
        }
        Insert: {
          avg_price: number
          buy_date?: string | null
          created_at?: string | null
          id?: string
          name: string
          quantity: number
          report_date?: string | null
          result?: Json | null
          ticker: string
          user_id?: string | null
        }
        Update: {
          avg_price?: number
          buy_date?: string | null
          created_at?: string | null
          id?: string
          name?: string
          quantity?: number
          report_date?: string | null
          result?: Json | null
          ticker?: string
          user_id?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          billing_key: string | null
          created_at: string | null
          depositor_real_name: string | null
          email: string | null
          email_alert_enabled: boolean
          has_seen_welcome: boolean
          id: string
          is_annual: boolean
          morning_briefing_enabled: boolean
          next_billed_at: string | null
          payment_method: string | null
          phone: string | null
          plan: string
          portfolio_credits: number
          privacy_agreed_at: string | null
          stock_credits: number
          subscription_plan: string | null
          subscription_start_date: string | null
          subscription_status: string | null
          terms_agreed_at: string | null
          welcome_email_sent_at: string | null
        }
        Insert: {
          billing_key?: string | null
          created_at?: string | null
          depositor_real_name?: string | null
          email?: string | null
          email_alert_enabled?: boolean
          has_seen_welcome?: boolean
          id: string
          is_annual?: boolean
          morning_briefing_enabled?: boolean
          next_billed_at?: string | null
          payment_method?: string | null
          phone?: string | null
          plan?: string
          portfolio_credits?: number
          privacy_agreed_at?: string | null
          stock_credits?: number
          subscription_plan?: string | null
          subscription_start_date?: string | null
          subscription_status?: string | null
          terms_agreed_at?: string | null
          welcome_email_sent_at?: string | null
        }
        Update: {
          billing_key?: string | null
          created_at?: string | null
          depositor_real_name?: string | null
          email?: string | null
          email_alert_enabled?: boolean
          has_seen_welcome?: boolean
          id?: string
          is_annual?: boolean
          morning_briefing_enabled?: boolean
          next_billed_at?: string | null
          payment_method?: string | null
          phone?: string | null
          plan?: string
          portfolio_credits?: number
          privacy_agreed_at?: string | null
          stock_credits?: number
          subscription_plan?: string | null
          subscription_start_date?: string | null
          subscription_status?: string | null
          terms_agreed_at?: string | null
          welcome_email_sent_at?: string | null
        }
        Relationships: []
      }
      watchlist: {
        Row: {
          created_at: string | null
          id: string
          market: string | null
          name: string
          sort_order: number | null
          ticker: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          market?: string | null
          name: string
          sort_order?: number | null
          ticker: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          market?: string | null
          name?: string
          sort_order?: number | null
          ticker?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_credit: {
        Args: { p_amount: number; p_credit_type: string; p_user_id: string }
        Returns: number
      }
      deduct_credit: {
        Args: { p_credit_type: string; p_user_id: string }
        Returns: number
      }
      update_watchlist_order: {
        Args: { p_orders: number[]; p_tickers: string[]; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
