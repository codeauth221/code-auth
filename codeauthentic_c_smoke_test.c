/*
 * CodeAuthentic C smoke test
 * A self-contained C11 program that analyzes classroom scores.
 * This sample is AI-generated for testing the inference pipeline.
 */

#include <stdio.h>
#include <string.h>

#define SUBJECT_COUNT 3
#define STUDENT_COUNT 8

typedef struct {
    char name[32];
    int scores[SUBJECT_COUNT];
    double average;
} Student;

static double calculate_average(const int scores[SUBJECT_COUNT]) {
    int total = 0;

    for (int i = 0; i < SUBJECT_COUNT; ++i) {
        total += scores[i];
    }

    return (double)total / SUBJECT_COUNT;
}

static char letter_grade(double average) {
    if (average >= 90.0) return 'A';
    if (average >= 80.0) return 'B';
    if (average >= 70.0) return 'C';
    if (average >= 60.0) return 'D';
    return 'F';
}

static void update_averages(Student students[], int count) {
    for (int i = 0; i < count; ++i) {
        students[i].average = calculate_average(students[i].scores);
    }
}

static void sort_by_average(Student students[], int count) {
    for (int i = 1; i < count; ++i) {
        Student current = students[i];
        int j = i - 1;

        while (j >= 0 && students[j].average < current.average) {
            students[j + 1] = students[j];
            --j;
        }

        students[j + 1] = current;
    }
}

static double classroom_average(const Student students[], int count) {
    double sum = 0.0;

    if (count <= 0) return 0.0;

    for (int i = 0; i < count; ++i) {
        sum += students[i].average;
    }

    return sum / count;
}

static int count_passing(const Student students[], int count) {
    int passing = 0;

    for (int i = 0; i < count; ++i) {
        if (students[i].average >= 75.0) {
            ++passing;
        }
    }

    return passing;
}

static void print_report(const Student students[], int count) {
    printf("%-4s %-14s %7s %7s %7s %9s %6s\n",
           "Rank", "Student", "Math", "Sci", "Eng", "Average", "Grade");
    printf("---------------------------------------------------------------\n");

    for (int i = 0; i < count; ++i) {
        printf("%-4d %-14s %7d %7d %7d %9.2f %6c\n",
               i + 1,
               students[i].name,
               students[i].scores[0],
               students[i].scores[1],
               students[i].scores[2],
               students[i].average,
               letter_grade(students[i].average));
    }

    printf("\nClass average: %.2f\n", classroom_average(students, count));
    printf("Students passing (75+): %d of %d\n", count_passing(students, count), count);
}

int main(void) {
    Student students[STUDENT_COUNT] = {
        {"Ari",    {92, 87, 90}, 0.0},
        {"Bea",    {75, 81, 79}, 0.0},
        {"Carlo",  {88, 84, 91}, 0.0},
        {"Dina",   {67, 74, 70}, 0.0},
        {"Emil",   {96, 93, 98}, 0.0},
        {"Faith",  {82, 85, 80}, 0.0},
        {"Gio",    {71, 69, 73}, 0.0},
        {"Hana",   {90, 94, 89}, 0.0}
    };

    update_averages(students, STUDENT_COUNT);
    sort_by_average(students, STUDENT_COUNT);
    print_report(students, STUDENT_COUNT);

    return 0;
}
