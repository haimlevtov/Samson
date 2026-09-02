export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      achievement_events: {
        Row: {
          achievement_id: string
          id: string
          local_date: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          id?: string
          local_date: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          id?: string
          local_date?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "achievement_events_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "achievement_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      achievements: {
        Row: {
          created_at: string
          description: string
          hidden: boolean
          humor_level: string
          id: string
          name: string
          predicate: string
          slug: string
          source_hint: string | null
          tier: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description: string
          hidden?: boolean
          humor_level?: string
          id?: string
          name: string
          predicate: string
          slug: string
          source_hint?: string | null
          tier: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          hidden?: boolean
          humor_level?: string
          id?: string
          name?: string
          predicate?: string
          slug?: string
          source_hint?: string | null
          tier?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      challenges: {
        Row: {
          created_at: string
          id: string
          kind: string
          slug: string
          spec: Json
          status: string
          user_id: string | null
          validation_reasons: Json
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          slug: string
          spec?: Json
          status?: string
          user_id?: string | null
          validation_reasons?: Json
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          slug?: string
          spec?: Json
          status?: string
          user_id?: string | null
          validation_reasons?: Json
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      equipment_tags: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_tags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      exercise_equipment: {
        Row: {
          equipment_tag_id: string
          exercise_id: string
          user_id: string | null
        }
        Insert: {
          equipment_tag_id: string
          exercise_id: string
          user_id?: string | null
        }
        Update: {
          equipment_tag_id?: string
          exercise_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercise_equipment_equipment_tag_id_fkey"
            columns: ["equipment_tag_id"]
            isOneToOne: false
            referencedRelation: "equipment_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_equipment_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_equipment_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      exercises: {
        Row: {
          category: string | null
          created_at: string
          id: string
          instructions: string | null
          is_unilateral: boolean
          movement_pattern: string | null
          name: string
          primary_muscle: string
          secondary_muscles: string[]
          slug: string
          source: string | null
          source_id: string | null
          user_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          instructions?: string | null
          is_unilateral?: boolean
          movement_pattern?: string | null
          name: string
          primary_muscle: string
          secondary_muscles?: string[]
          slug: string
          source?: string | null
          source_id?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          instructions?: string | null
          is_unilateral?: boolean
          movement_pattern?: string | null
          name?: string
          primary_muscle?: string
          secondary_muscles?: string[]
          slug?: string
          source?: string | null
          source_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      llm_calls: {
        Row: {
          attempt: number
          cache_write_tokens: number | null
          cached_tokens: number | null
          completion_tokens: number | null
          cost_credits: number | null
          created_at: string
          error: string | null
          id: string
          latency_ms: number | null
          model_used: string | null
          models_requested: string[]
          openrouter_id: string | null
          prompt_prefix_hash: string | null
          prompt_tokens: number | null
          reasoning_tokens: number | null
          stage: string
          status: string
          total_tokens: number | null
          upstream_cost: number | null
          user_id: string
        }
        Insert: {
          attempt?: number
          cache_write_tokens?: number | null
          cached_tokens?: number | null
          completion_tokens?: number | null
          cost_credits?: number | null
          created_at?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          model_used?: string | null
          models_requested?: string[]
          openrouter_id?: string | null
          prompt_prefix_hash?: string | null
          prompt_tokens?: number | null
          reasoning_tokens?: number | null
          stage: string
          status: string
          total_tokens?: number | null
          upstream_cost?: number | null
          user_id: string
        }
        Update: {
          attempt?: number
          cache_write_tokens?: number | null
          cached_tokens?: number | null
          completion_tokens?: number | null
          cost_credits?: number | null
          created_at?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          model_used?: string | null
          models_requested?: string[]
          openrouter_id?: string | null
          prompt_prefix_hash?: string | null
          prompt_tokens?: number | null
          reasoning_tokens?: number | null
          stage?: string
          status?: string
          total_tokens?: number | null
          upstream_cost?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_calls_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      personas: {
        Row: {
          banned_phrases: string[]
          created_at: string
          humor_level: string
          id: string
          intensity: number
          is_active: boolean
          name: string
          slug: string
          system_prompt: string
          tts_voice_id: string | null
          user_id: string | null
        }
        Insert: {
          banned_phrases?: string[]
          created_at?: string
          humor_level?: string
          id?: string
          intensity?: number
          is_active?: boolean
          name: string
          slug: string
          system_prompt: string
          tts_voice_id?: string | null
          user_id?: string | null
        }
        Update: {
          banned_phrases?: string[]
          created_at?: string
          humor_level?: string
          id?: string
          intensity?: number
          is_active?: boolean
          name?: string
          slug?: string
          system_prompt?: string
          tts_voice_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "personas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      plan_runs: {
        Row: {
          block: Json | null
          created_at: string
          id: string
          input_hash: string | null
          iterations: number
          rejections: Json
          status: string
          user_id: string
        }
        Insert: {
          block?: Json | null
          created_at?: string
          id?: string
          input_hash?: string | null
          iterations: number
          rejections?: Json
          status: string
          user_id: string
        }
        Update: {
          block?: Json | null
          created_at?: string
          id?: string
          input_hash?: string | null
          iterations?: number
          rejections?: Json
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      progression_nodes: {
        Row: {
          created_at: string
          exercise_id: string | null
          id: string
          level: number
          name: string
          parent_id: string | null
          slug: string
          tree: string
          unlock_criteria: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          exercise_id?: string | null
          id?: string
          level?: number
          name: string
          parent_id?: string | null
          slug: string
          tree: string
          unlock_criteria?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          exercise_id?: string | null
          id?: string
          level?: number
          name?: string
          parent_id?: string | null
          slug?: string
          tree?: string
          unlock_criteria?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "progression_nodes_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progression_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "progression_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progression_nodes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sets: {
        Row: {
          completed_at: string | null
          created_at: string
          exercise_id: string
          id: string
          is_warmup: boolean
          reps: number | null
          rest_seconds: number | null
          rpe: number | null
          set_index: number
          user_id: string
          weight_kg: number | null
          workout_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          exercise_id: string
          id?: string
          is_warmup?: boolean
          reps?: number | null
          rest_seconds?: number | null
          rpe?: number | null
          set_index: number
          user_id: string
          weight_kg?: number | null
          workout_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          exercise_id?: string
          id?: string
          is_warmup?: boolean
          reps?: number | null
          rest_seconds?: number | null
          rpe?: number | null
          set_index?: number
          user_id?: string
          weight_kg?: number | null
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sets_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_equipment: {
        Row: {
          created_at: string
          equipment_tag_id: string
          max_load_kg: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          equipment_tag_id: string
          max_load_kg?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          equipment_tag_id?: string
          max_load_kg?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_equipment_equipment_tag_id_fkey"
            columns: ["equipment_tag_id"]
            isOneToOne: false
            referencedRelation: "equipment_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_equipment_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      users: {
        Row: {
          birth_date: string | null
          bodyweight_kg: number | null
          created_at: string
          display_name: string | null
          height_cm: number | null
          humor_max_level: string
          llm_weekly_budget_usd: number
          sex: string | null
          timezone: string
          unit_preference: string
          updated_at: string
          user_id: string
        }
        Insert: {
          birth_date?: string | null
          bodyweight_kg?: number | null
          created_at?: string
          display_name?: string | null
          height_cm?: number | null
          humor_max_level?: string
          llm_weekly_budget_usd?: number
          sex?: string | null
          timezone?: string
          unit_preference?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          birth_date?: string | null
          bodyweight_kg?: number | null
          created_at?: string
          display_name?: string | null
          height_cm?: number | null
          humor_max_level?: string
          llm_weekly_budget_usd?: number
          sex?: string | null
          timezone?: string
          unit_preference?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workouts: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          local_date: string
          notes: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          local_date: string
          notes?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          local_date?: string
          notes?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      xp_events: {
        Row: {
          amount: number
          created_at: string
          id: string
          local_date: string
          occurred_at: string
          source: string
          user_id: string
          week_start: string
          workout_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          local_date: string
          occurred_at?: string
          source: string
          user_id: string
          week_start: string
          workout_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          local_date?: string
          occurred_at?: string
          source?: string
          user_id?: string
          week_start?: string
          workout_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "xp_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "xp_events_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      award_session_xp: {
        Args: { p_workout_id: string }
        Returns: Json
      }
      evaluate_achievements: {
        Args: { p_user_id: string }
        Returns: string[]
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

